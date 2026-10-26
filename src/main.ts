import * as cli from '@actions/exec'
import * as core from '@actions/core'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as tc from '@actions/tool-cache'
import * as zlib from 'zlib'
import { pipeline } from 'stream/promises'

// would have preferred to use coursier.core.Version here,
// but coursier is not published on npm
import { compareVersions } from 'compare-versions'

import checksums from './checksums.json'

const defaultVersion = '2.1.26'

// SHA-256 of the Coursier release assets, per version then per asset name. The update-coursier
// workflow regenerates it for the default version, from assets whose build provenance
// attestation it verified. Downloads of other versions (and of nightlies) aren't verified.
const pinnedChecksums: { [version: string]: { [asset: string]: string } | undefined } = checksums

// compare-versions doesn't know about Coursier milestone versions, like "2.1.25-M3",
// which come *before* the corresponding release ("2.1.25"). Split those in two, so that
// we can compare the release parts first, and the milestone numbers only as a tie-breaker.
export function splitMilestone(version: string): [string, number] {
  const match = /^(.+)-M(\d+)$/.exec(version)
  return match ? [match[1], parseInt(match[2], 10)] : [version, Number.MAX_SAFE_INTEGER]
}

export function compareCoursierVersions(a: string, b: string): number {
  const [aVersion, aMilestone] = splitMilestone(a)
  const [bVersion, bMilestone] = splitMilestone(b)
  const versionComparison = compareVersions(aVersion, bVersion)
  return versionComparison === 0 ? Math.sign(aMilestone - bMilestone) : versionComparison
}

// Nightly builds are published under the fixed tag "nightly" (no "v" prefix).
// See https://github.com/coursier/coursier/releases/tag/nightly
export function getReleaseTag(version: string): string {
  return version === 'nightly' ? 'nightly' : `v${version}`
}

export function useVirtusLabRepo(version: string, platform: string, arch: string): boolean {
  return (
    version !== 'nightly' &&
    arch === 'arm64' &&
    ((platform == 'darwin' && compareCoursierVersions(version, '2.1.16') < 0) ||
      (platform == 'linux' && compareCoursierVersions(version, '2.1.25-M3') < 0))
  )
}

export function getCoursierArchitecture(arch: string): string {
  if (arch === 'x64') {
    return 'x86_64'
  } else if (arch === 'arm' || arch === 'arm64') {
    return 'aarch64'
  } else {
    throw new Error(`Coursier does not have support for the ${arch} architecture`)
  }
}

async function execOutput(
  cmd: string,
  args: string[],
  env?: { [key: string]: string },
): Promise<string> {
  let output = ''
  const options: cli.ExecOptions = {
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString()
      },
    },
  }
  if (env) {
    options.env = env
  }
  await cli.exec(cmd, args.filter(Boolean), options)
  return output.trim()
}

async function sha256(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256')
  for await (const chunk of fs.createReadStream(filePath)) {
    hash.update(chunk)
  }
  return hash.digest('hex')
}

export function checkChecksumRequirement(
  version: string,
  required: boolean,
  checksums: { [version: string]: unknown } = pinnedChecksums,
): void {
  if (required && !checksums[version]) {
    const pinned = Object.keys(checksums).join(', ')
    throw new Error(
      `requireChecksum is enabled, but there are no pinned checksums for Coursier ${version} (pinned versions: ${pinned}). Use one of those versions, or leave version empty to use the default one.`,
    )
  }
}

async function downloadVerified(url: string, csVersion: string): Promise<string> {
  console.log(`Downloading ${url}`)
  const filePath = await tc.downloadTool(url)
  const asset = url.slice(url.lastIndexOf('/') + 1)
  const versionChecksums = pinnedChecksums[csVersion]
  if (!versionChecksums) {
    core.info(`No pinned checksums for Coursier ${csVersion}, not verifying ${asset}`)
    return filePath
  }
  const expected = versionChecksums[asset]
  const actual = await sha256(filePath)
  if (actual !== expected) {
    fs.rmSync(filePath, { force: true })
    throw new Error(
      expected
        ? `Checksum mismatch for ${url}: expected SHA-256 ${expected}, got ${actual}`
        : `No pinned checksum for ${asset} of Coursier ${csVersion}`,
    )
  }
  core.info(`Verified SHA-256 of ${asset}`)
  return filePath
}

export function validateLauncher(name: 'launcher' | 'preferredLauncher', input: string): string {
  const value = input.trim()
  if (value && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new Error(`Invalid ${name} value: ${value}`)
  }
  return value
}

function launcherInput(name: 'launcher' | 'preferredLauncher'): string {
  return validateLauncher(name, core.getInput(name))
}

interface Config {
  csVersion: string
  releaseTag: string
  // Set when launcher is one of the JVM launchers (thin / jvm / assembly)
  jvmLauncherType: 'thin' | 'assembly' | undefined
  // Native launcher flavor to download ('' for the default one)
  nativeLauncher: string
  preferredLauncher: string
  extraJvmArgs: string[]
  disableDefaultRepos: boolean
  customRepositories: string[]
  requireChecksum: boolean
}

function readConfig(): Config {
  const csVersion = core.getInput('version') || defaultVersion
  const releaseTag = getReleaseTag(csVersion)

  const requiredLauncher = launcherInput('launcher')
  const preferredLauncher = launcherInput('preferredLauncher')
  const normalizedLauncher = requiredLauncher.toLowerCase()
  const normalizedPreferredLauncher = preferredLauncher.toLowerCase()
  const jvmLaunchers = ['thin', 'jvm', 'assembly']
  if (jvmLaunchers.includes(normalizedPreferredLauncher)) {
    throw new Error(
      `preferredLauncher only accepts native launcher flavors; use launcher for the JVM launcher "${preferredLauncher}"`,
    )
  }
  if (requiredLauncher && preferredLauncher) {
    throw new Error('launcher and preferredLauncher cannot both be set')
  }
  const useContainerImage = core.getBooleanInput('useContainerImage')
  if (useContainerImage) {
    core.warning('useContainerImage is deprecated; use launcher: container instead')
  }
  const jvmLauncherType: 'thin' | 'assembly' | undefined = jvmLaunchers.includes(normalizedLauncher)
    ? normalizedLauncher === 'assembly'
      ? 'assembly'
      : 'thin'
    : undefined
  // Keep the old flag working, but let either of the new inputs take precedence.
  // Empty launcher on Windows ARM64 downloads cs-aarch64-pc-win32-jvm.zip (see downloadCoursier).
  const nativeLauncher =
    requiredLauncher || preferredLauncher || (useContainerImage ? 'container' : '')

  const extraJvmArgs = parseExtraJvmArgs(core.getInput('extraJvmArgs'))

  const disableDefaultRepos = core.getBooleanInput('disableDefaultRepos')

  const customRepositoryInput = core.getInput('customRepositories')
  const customRepositories = customRepositoryInput
    ? customRepositoryInput.split('|').map(repo => repo.trim())
    : []

  const requireChecksum = core.getBooleanInput('requireChecksum')

  return {
    csVersion,
    releaseTag,
    jvmLauncherType,
    nativeLauncher,
    preferredLauncher,
    extraJvmArgs,
    disableDefaultRepos,
    customRepositories,
    requireChecksum,
  }
}

async function downloadJvmCoursier(
  config: Config,
  launcherType: 'thin' | 'assembly',
): Promise<{ path: string; isDir: boolean }> {
  const baseUrl = `https://github.com/coursier/coursier/releases/download/${config.releaseTag}`

  if (launcherType === 'assembly') {
    const url = `${baseUrl}/coursier.jar`
    const jarDownloaded = await downloadVerified(url, config.csVersion)
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-assembly-'))
    fs.copyFileSync(jarDownloaded, path.join(tempDir, 'coursier.jar'))

    if (process.platform === 'win32') {
      fs.writeFileSync(
        path.join(tempDir, 'cs.bat'),
        '@echo off\njava -jar "%~dp0coursier.jar" %*\n',
      )
    } else {
      const wrapperPath = path.join(tempDir, 'cs')
      fs.writeFileSync(
        wrapperPath,
        '#!/bin/sh\nexec java -jar "$(dirname "$0")/coursier.jar" "$@"\n',
      )
      fs.chmodSync(wrapperPath, 0o755)
    }
    return { path: tempDir, isDir: true }
  }

  const url = `${baseUrl}/coursier`
  const filePath = await downloadVerified(url, config.csVersion)
  if (process.platform !== 'win32') {
    fs.chmodSync(filePath, 0o755)
    return { path: filePath, isDir: false }
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-thin-'))
  fs.copyFileSync(filePath, path.join(tempDir, 'coursier'))
  fs.writeFileSync(path.join(tempDir, 'cs.bat'), '@echo off\njava -jar "%~dp0coursier" %*\n')
  return { path: tempDir, isDir: true }
}

async function installJvmCoursier(
  config: Config,
  launcherType: 'thin' | 'assembly',
): Promise<string> {
  const toolName = `cs-${launcherType}`
  const previous = tc.find(toolName, config.csVersion)
  if (previous) {
    core.addPath(previous)
    return previous
  }

  const { path: binaryPath, isDir } = await downloadJvmCoursier(config, launcherType)
  if (!isDir) {
    const csCached = await tc.cacheFile(binaryPath, 'cs', toolName, config.csVersion)
    core.addPath(csCached)
    return csCached
  }

  try {
    const csCached = await tc.cacheDir(binaryPath, toolName, config.csVersion)
    core.addPath(csCached)
    return csCached
  } finally {
    fs.rmSync(binaryPath, { recursive: true, force: true })
  }
}

// Returns the URL of the native launcher archive for the given platform / architecture.
// launcher is the launcher flavor ('' for the default one), appended as a suffix.
export function coursierDownloadUrl(
  version: string,
  platform: string,
  arch: string,
  launcher: string,
): string {
  const repository = useVirtusLabRepo(version, platform, arch)
    ? 'https://github.com/VirtusLab/coursier-m1/'
    : 'https://github.com/coursier/coursier/'
  const baseUrl = `${repository}/releases/download/${getReleaseTag(version)}/cs-${getCoursierArchitecture(arch)}`
  const launcherSuffix = launcher ? `-${launcher}` : ''
  switch (platform) {
    case 'linux':
      return `${baseUrl}-pc-linux${launcherSuffix}.gz`
    case 'darwin':
      return `${baseUrl}-apple-darwin${launcherSuffix}.gz`
    case 'win32':
      return `${baseUrl}-pc-win32${launcherSuffix}.zip`
    default:
      throw new Error(`Unknown process.platform: ${platform}`)
  }
}

async function downloadCoursier(
  config: Config,
  launcher: string,
): Promise<{ path: string; isDir: boolean }> {
  const architecture = getCoursierArchitecture(process.arch)
  // Windows ARM64 has no GraalVM native image; the default artifact is the jpackage JVM distribution
  // (cs-aarch64-pc-win32-jvm.zip), which embeds a runtime under app/ and runtime/.
  const effectiveLauncher =
    launcher !== ''
      ? launcher
      : process.platform === 'win32' && process.arch === 'arm64'
        ? 'jvm'
        : ''
  const isWindowsJvmPackagedLauncher =
    process.platform === 'win32' && process.arch === 'arm64' && effectiveLauncher === 'jvm'
  let csBinary = ''
  switch (process.platform) {
    case 'linux': {
      const url = coursierDownloadUrl(
        config.csVersion,
        process.platform,
        process.arch,
        effectiveLauncher,
      )
      const archive = await downloadVerified(url, config.csVersion)
      csBinary = await gunzip(archive)
      break
    }
    case 'darwin': {
      const url = coursierDownloadUrl(
        config.csVersion,
        process.platform,
        process.arch,
        effectiveLauncher,
      )
      const archive = await downloadVerified(url, config.csVersion)
      csBinary = await gunzip(archive)
      break
    }
    case 'win32': {
      const url = coursierDownloadUrl(
        config.csVersion,
        process.platform,
        process.arch,
        effectiveLauncher,
      )
      const guid = await downloadVerified(url, config.csVersion)
      // Expand-Archive (used by tc.extractZip on some Windows setups) requires a .zip extension
      const archive = `${guid}.zip`
      fs.renameSync(guid, archive)
      const destDir = await tc.extractZip(archive, guid)
      if (isWindowsJvmPackagedLauncher) {
        // jpackage layout: cs.exe plus app/ and runtime/ — keep the full tree.
        return { path: destDir, isDir: true }
      }
      const exeName = `cs-${architecture}-pc-win32.exe`
      const exe = fs
        .readdirSync(destDir, { recursive: true, encoding: 'utf8' })
        .find(entry => path.basename(entry) === exeName)
      if (!exe) throw new Error(`${exeName} not found in ${url}`)
      csBinary = path.join(destDir, exe)
      break
    }
    default:
      throw new Error(
        `Unsupported platform: ${process.platform} (supported platforms: linux, darwin, win32)`,
      )
  }
  if (!csBinary) throw new Error(`Couldn't download Coursier`)
  if (process.platform !== 'win32') fs.chmodSync(csBinary, 0o755)
  return { path: csBinary, isDir: false }
}

async function installNativeCoursier(config: Config): Promise<void> {
  const requestedLauncher = config.nativeLauncher
  const toolName = requestedLauncher ? `cs-launcher-${requestedLauncher}` : 'cs'

  const previous = tc.find(toolName, config.csVersion)
  if (previous) {
    core.addPath(previous)
    return
  }

  let downloadedLauncher = requestedLauncher
  let downloaded: { path: string; isDir: boolean }
  try {
    downloaded = await downloadCoursier(config, requestedLauncher)
  } catch (error: unknown) {
    if (
      config.preferredLauncher &&
      error instanceof tc.HTTPError &&
      error.httpStatusCode !== undefined &&
      error.httpStatusCode >= 400 &&
      error.httpStatusCode < 500
    ) {
      core.warning(
        `Preferred Coursier launcher "${config.preferredLauncher}" is not available (HTTP ${error.httpStatusCode}); falling back to the default launcher`,
      )
      downloadedLauncher = ''
      downloaded = await downloadCoursier(config, '')
    } else {
      throw error
    }
  }
  const binaryName = process.platform === 'win32' ? 'cs.exe' : 'cs'
  const downloadedToolName = downloadedLauncher ? `cs-launcher-${downloadedLauncher}` : 'cs'
  const csCached = downloaded.isDir
    ? await tc.cacheDir(downloaded.path, downloadedToolName, config.csVersion)
    : await tc.cacheFile(downloaded.path, binaryName, downloadedToolName, config.csVersion)
  core.addPath(csCached)
}

// Parses the extraJvmArgs input into -J-prefixed args, only accepting -D system properties
export function parseExtraJvmArgs(input: string): string[] {
  if (!input) return []
  return input
    .trim()
    .split(/\s+/)
    .map(raw => {
      const arg = raw.startsWith('-J') ? raw : `-J${raw}`
      if (!/^-J-D[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)*(=.*)?$/.test(arg)) {
        throw new Error(
          `Invalid JVM argument: ${raw}. Expected format: -J-D<key>=<value> (e.g. -J-Dhttps.proxyHost=proxy.example.com)`,
        )
      }
      return arg
    })
}

// Decompresses a .gz file next to it, removes the archive, and returns the decompressed file path
async function gunzip(archive: string): Promise<string> {
  const dest = `${archive}-cs`
  await pipeline(fs.createReadStream(archive), zlib.createGunzip(), fs.createWriteStream(dest))
  fs.rmSync(archive, { force: true })
  return dest
}

// How to run the installed launcher
interface Coursier {
  // On Windows, JVM launchers are run via `java -jar <jar>`
  windowsJar?: string
  // The Windows ARM64 jpackage launcher (cs-aarch64-pc-win32-jvm.zip) does not support
  // GraalVM-style -J flags; they are treated as application args and break CLI parsing.
  // Extra JVM properties are passed via JAVA_TOOL_OPTIONS instead.
  usesJavaToolOptions: boolean
}

async function installCoursier(config: Config): Promise<Coursier> {
  const { jvmLauncherType } = config
  if (jvmLauncherType) {
    const jvmLauncherPath = await installJvmCoursier(config, jvmLauncherType)
    if (process.platform === 'win32') {
      const jarName = jvmLauncherType === 'assembly' ? 'coursier.jar' : 'coursier'
      return { windowsJar: path.join(jvmLauncherPath, jarName), usesJavaToolOptions: false }
    }
    return { usesJavaToolOptions: false }
  }

  await installNativeCoursier(config)
  return { usesJavaToolOptions: process.platform === 'win32' && process.arch === 'arm64' }
}

async function cs(config: Config, coursier: Coursier, ...args: string[]): Promise<string> {
  const { extraJvmArgs } = config
  const csArgs = [
    ...args,
    ...(config.disableDefaultRepos ? ['--no-default'] : []),
    ...config.customRepositories.flatMap(repo => ['-r', repo]),
  ]

  if (coursier.windowsJar) {
    return execOutput('java', [
      ...extraJvmArgs.map(arg => arg.slice(2)),
      '-jar',
      coursier.windowsJar,
      ...csArgs,
    ])
  }

  if (coursier.usesJavaToolOptions && extraJvmArgs.length) {
    const toolOptions = extraJvmArgs.map(arg => arg.slice(2)).join(' ')
    const env: { [key: string]: string } = { ...process.env } as { [key: string]: string }
    env.JAVA_TOOL_OPTIONS = [process.env.JAVA_TOOL_OPTIONS, toolOptions].filter(Boolean).join(' ')
    return execOutput('cs', csArgs, env)
  }

  return execOutput('cs', [...extraJvmArgs, ...csArgs])
}

// Turns the from=to lines of the mirrors input into mirror.properties lines
export function parseMirrors(mirrorsInput: string): string[] {
  const entries = mirrorsInput
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))

  const lines: string[] = []
  entries.forEach((entry, idx) => {
    const eq = entry.indexOf('=')
    if (eq < 0) {
      throw new Error(`Invalid mirror entry (expected from=to): ${entry}`)
    }
    const from = entry.slice(0, eq).trim()
    const to = entry.slice(eq + 1).trim()
    if (!from || !to) {
      throw new Error(`Invalid mirror entry (empty side): ${entry}`)
    }
    const prefix = `setupActionMirror${idx}`
    lines.push(`${prefix}.from=${from}`)
    lines.push(`${prefix}.to=${to}`)
  })
  return lines
}

function writeMirrorsFile(): void {
  const mirrorsInput = core.getInput('mirrors')
  if (!mirrorsInput.trim()) return

  const lines = parseMirrors(mirrorsInput)
  const entryCount = lines.length / 2

  // Write to a file we own rather than to the user's coursier config directory (whose
  // location is platform-specific, and which may already have a mirror.properties),
  // and point coursier at it via COURSIER_EXTRA_MIRRORS, read on top of the default files.
  const mirrorDir = path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'coursier-setup-action')
  fs.mkdirSync(mirrorDir, { recursive: true })
  const mirrorFile = path.join(mirrorDir, 'mirror.properties')

  // COURSIER_EXTRA_MIRRORS only accepts a single file, so if the user already set it,
  // keep their mirrors by copying their file's content into ours.
  const existing = process.env.COURSIER_EXTRA_MIRRORS
  let content = ''
  if (existing && path.resolve(existing) !== mirrorFile) {
    try {
      content = fs.readFileSync(existing, 'utf8').replace(/\n?$/, '\n')
      core.info(`Including mirrors from existing COURSIER_EXTRA_MIRRORS file ${existing}`)
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      core.warning(
        `Could not read existing COURSIER_EXTRA_MIRRORS file ${existing}, its mirrors will be ignored: ${msg}`,
      )
    }
  }
  content += lines.join('\n') + '\n'

  fs.writeFileSync(mirrorFile, content)
  // also updates process.env, so that our own cs invocations see it
  core.exportVariable('COURSIER_EXTRA_MIRRORS', mirrorFile)
  console.log(
    `Wrote ${entryCount} mirror entr${entryCount === 1 ? 'y' : 'ies'} to ${mirrorFile} (exported as COURSIER_EXTRA_MIRRORS)`,
  )
}

export async function run(): Promise<void> {
  try {
    const config = readConfig()
    checkChecksumRequirement(config.csVersion, config.requireChecksum)
    writeMirrorsFile()

    const coursier = await core.group('Install Coursier', async () => {
      const coursier = await installCoursier(config)
      await cs(config, coursier, '--help')
      // cs is on the PATH now. Call it directly rather than via cs(), as `cs version`
      // rejects the --no-default / -r options that cs() may append.
      let installedVersion = ''
      try {
        installedVersion = await execOutput('cs', ['version'])
      } catch (error: unknown) {
        core.debug(`cs version failed: ${error instanceof Error ? error.message : String(error)}`)
      }
      if (!/^\S+$/.test(installedVersion)) {
        core.warning(
          `Could not get the installed Coursier version from "cs version", reporting ${config.csVersion} instead`,
        )
        installedVersion = config.csVersion
      }
      core.setOutput('cs-version', installedVersion)
      return coursier
    })

    await core.group('Install JVM', async () => {
      const jvmInput = core.getInput('jvm')
      const jvmIndexInput = core.getInput('jvm-index')
      const jvmArg = jvmInput ? ['--jvm', jvmInput] : []
      const jvmIndexArg = jvmIndexInput ? ['--jvm-index', jvmIndexInput] : []
      if (!jvmInput && process.env.JAVA_HOME) {
        core.info(`skipping, JVM is already installed in ${process.env.JAVA_HOME}`)
        core.setOutput('java-home', process.env.JAVA_HOME)
      } else {
        await cs(config, coursier, 'java', ...jvmArg, ...jvmIndexArg, '-version')
        const csJavaHome = await cs(config, coursier, 'java-home', ...jvmArg, ...jvmIndexArg)
        core.exportVariable('JAVA_HOME', csJavaHome)
        core.addPath(path.join(csJavaHome, 'bin'))
        core.setOutput('java-home', csJavaHome)
      }
    })

    await core.group('Install Apps', async () => {
      const apps: string[] = core.getInput('apps').split(/\s+/).filter(Boolean)
      if (apps.length) {
        const coursierBinDir = path.join(os.homedir(), 'cs', 'bin')
        core.exportVariable('COURSIER_BIN_DIR', coursierBinDir)
        core.addPath(coursierBinDir)
        await cs(config, coursier, 'install', '--contrib', ...apps)
        core.setOutput('cs-bin-dir', coursierBinDir)
      }
    })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    core.setFailed(msg)
  }
}
