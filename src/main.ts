import * as cli from '@actions/exec'
import * as core from '@actions/core'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as tc from '@actions/tool-cache'

// would have preferred to use coursier.core.Version here,
// but coursier is not published on npm
import { compareVersions } from 'compare-versions'

const defaultVersion = '2.1.25-M19'

const csVersion = core.getInput('version') || defaultVersion
const useVirtusLabRepo =
  process.arch === 'arm64' &&
  ((process.platform == 'darwin' && compareVersions(csVersion.replace('-M', '.'), '2.1.16') < 0) ||
    (process.platform == 'linux' && compareVersions(csVersion.replace('-M', '.'), '2.1.25.3') < 0))
const coursierBinariesGithubRepository = useVirtusLabRepo
  ? 'https://github.com/VirtusLab/coursier-m1/'
  : 'https://github.com/coursier/coursier/'
let resolvedLauncher: string | undefined
let warnedAboutUseContainerImage = false

function getCoursierArchitecture(arch: string): string {
  if (arch === 'x64') {
    return 'x86_64'
  } else if (arch === 'arm' || arch === 'arm64') {
    return 'aarch64'
  } else {
    throw new Error(`Coursier does not have support for the ${arch} architecture`)
  }
}

async function execOutput(cmd: string, ...args: string[]): Promise<string> {
  let output = ''
  const options = {
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString()
      },
    },
  }
  await cli.exec(cmd, args.filter(Boolean), options)
  return output.trim()
}

function launcherInput(name: 'launcher' | 'preferredLauncher'): string {
  const value = core.getInput(name).trim()
  if (value && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new Error(`Invalid ${name} value: ${value}`)
  }
  return value
}

async function downloadJvmCoursier(
  launcherType: 'thin' | 'assembly',
): Promise<{ path: string; isDir: boolean }> {
  const baseUrl = `https://github.com/coursier/coursier/releases/download/v${csVersion}`

  if (launcherType === 'assembly') {
    const url = `${baseUrl}/coursier.jar`
    console.log(`Downloading ${url}`)
    const jarDownloaded = await tc.downloadTool(url)
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
  console.log(`Downloading ${url}`)
  const filePath = await tc.downloadTool(url)
  if (process.platform !== 'win32') {
    await cli.exec('chmod', ['+x', filePath])
    return { path: filePath, isDir: false }
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-thin-'))
  fs.copyFileSync(filePath, path.join(tempDir, 'coursier'))
  fs.writeFileSync(path.join(tempDir, 'cs.bat'), '@echo off\njava -jar "%~dp0coursier" %*\n')
  return { path: tempDir, isDir: true }
}

async function installJvmCoursier(launcherType: 'thin' | 'assembly'): Promise<void> {
  const toolName = `cs-${launcherType}`
  const previous = tc.find(toolName, csVersion)
  if (previous) {
    core.addPath(previous)
    return
  }

  const { path: binaryPath, isDir } = await downloadJvmCoursier(launcherType)
  if (!isDir) {
    const csCached = await tc.cacheFile(binaryPath, 'cs', toolName, csVersion)
    core.addPath(csCached)
    return
  }

  try {
    const csCached = await tc.cacheDir(binaryPath, toolName, csVersion)
    core.addPath(csCached)
  } finally {
    fs.rmSync(binaryPath, { recursive: true, force: true })
  }
}

async function downloadCoursier(launcher: string): Promise<string> {
  const architecture = getCoursierArchitecture(process.arch)
  const baseUrl = `${coursierBinariesGithubRepository}/releases/download/v${csVersion}/cs-${architecture}`
  const launcherSuffix = launcher ? `-${launcher}` : ''
  let csBinary = ''
  switch (process.platform) {
    case 'linux': {
      const url = `${baseUrl}-pc-linux${launcherSuffix}.gz`
      console.log(`Downloading ${url}`)
      const guid = await tc.downloadTool(url)
      const archive = `${guid}.gz`
      await cli.exec('mv', [guid, archive])
      csBinary = archive
      break
    }
    case 'darwin': {
      const url = `${baseUrl}-apple-darwin${launcherSuffix}.gz`
      console.log(`Downloading ${url}`)
      const guid = await tc.downloadTool(url)
      const archive = `${guid}.gz`
      await cli.exec('mv', [guid, archive])
      csBinary = archive
      break
    }
    case 'win32': {
      const url = `${baseUrl}-pc-win32${launcherSuffix}.zip`
      console.log(`Downloading ${url}`)
      const guid = await tc.downloadTool(url)
      const archive = `${guid}.zip`
      await cli.exec('mv', [guid, archive])
      csBinary = archive
      break
    }
    default:
      core.setFailed(`Unknown process.platform: ${process.platform}`)
  }
  if (!csBinary) core.setFailed(`Couldn't download Coursier`)
  if (csBinary.endsWith('.gz')) {
    await cli.exec('gzip', ['-d', csBinary])
    csBinary = csBinary.slice(0, csBinary.length - '.gz'.length)
  }
  if (csBinary.endsWith('.zip')) {
    const destDir = csBinary.slice(0, csBinary.length - '.zip'.length)
    await cli.exec('unzip', ['-j', csBinary, `cs-${architecture}-pc-win32.exe`, '-d', destDir])
    csBinary = `${destDir}\\cs-${architecture}-pc-win32.exe`
  }
  await cli.exec('chmod', ['+x', csBinary])
  return csBinary
}

async function cs(...args: string[]): Promise<string> {
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
  if (useContainerImage && !warnedAboutUseContainerImage) {
    core.warning('useContainerImage is deprecated; use launcher: container instead')
    warnedAboutUseContainerImage = true
  }
  if (jvmLaunchers.includes(normalizedLauncher)) {
    await installJvmCoursier(normalizedLauncher === 'assembly' ? 'assembly' : 'thin')
  } else {
    // Keep the old flag working, but let either of the new inputs take precedence.
    const configuredLauncher =
      requiredLauncher || preferredLauncher || (useContainerImage ? 'container' : '')
    const requestedLauncher = resolvedLauncher ?? configuredLauncher
    const toolName = requestedLauncher ? `cs-launcher-${requestedLauncher}` : 'cs'

    const previous = tc.find(toolName, csVersion)
    if (previous) {
      resolvedLauncher = requestedLauncher
      core.addPath(previous)
    } else {
      let downloadedLauncher = requestedLauncher
      let csBinary: string
      try {
        csBinary = await downloadCoursier(requestedLauncher)
      } catch (error: unknown) {
        if (
          preferredLauncher &&
          resolvedLauncher === undefined &&
          error instanceof tc.HTTPError &&
          error.httpStatusCode !== undefined &&
          error.httpStatusCode >= 400 &&
          error.httpStatusCode < 500
        ) {
          core.warning(
            `Preferred Coursier launcher "${preferredLauncher}" is not available (HTTP ${error.httpStatusCode}); falling back to the default launcher`,
          )
          downloadedLauncher = ''
          csBinary = await downloadCoursier('')
        } else {
          throw error
        }
      }
      const binaryName = process.platform === 'win32' ? 'cs.exe' : 'cs'
      const downloadedToolName = downloadedLauncher ? `cs-launcher-${downloadedLauncher}` : 'cs'
      const csCached = await tc.cacheFile(csBinary, binaryName, downloadedToolName, csVersion)
      resolvedLauncher = downloadedLauncher
      core.addPath(csCached)
    }
  }

  const extraJvmArgsInput = core.getInput('extraJvmArgs')
  if (extraJvmArgsInput) {
    const extraArgs = extraJvmArgsInput
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
    args = [...extraArgs, ...args]
  }

  const disableDefaultReposInput = core.getInput('disableDefaultRepos')

  if (disableDefaultReposInput.toLowerCase() === 'true') {
    args.push('--no-default')
  }

  const customRepositoryInput = core.getInput('customRepositories')
  if (customRepositoryInput) {
    const repositories = customRepositoryInput.split('|')

    // For each repository, push the `-r` flag and the repository itself to the args list
    repositories.forEach(repo => {
      args.push('-r', repo.trim())
    })
  }

  return execOutput('cs', ...args)
}

function writeMirrorsFile(): void {
  const mirrorsInput = core.getInput('mirrors')
  if (!mirrorsInput.trim()) return

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
    const prefix = `mirror${idx}`
    lines.push(`${prefix}.from=${from}`)
    lines.push(`${prefix}.to=${to}`)
  })

  const configDir = path.join(os.homedir(), '.config', 'coursier')
  fs.mkdirSync(configDir, { recursive: true })
  const mirrorFile = path.join(configDir, 'mirror.properties')
  fs.writeFileSync(mirrorFile, lines.join('\n') + '\n')
  console.log(
    `Wrote ${entries.length} mirror entr${entries.length === 1 ? 'y' : 'ies'} to ${mirrorFile}`,
  )
}

async function run(): Promise<void> {
  try {
    writeMirrorsFile()

    await core.group('Install Coursier', async () => {
      await cs('--help')
      core.setOutput('cs-version', csVersion)
    })

    await core.group('Install JVM', async () => {
      const jvmInput = core.getInput('jvm')
      const jvmIndexInput = core.getInput('jvm-index')
      const jvmArg = jvmInput ? ['--jvm', jvmInput] : []
      const jvmIndexArg = jvmIndexInput ? ['--jvm-index', jvmIndexInput] : []
      if (!jvmInput && process.env.JAVA_HOME) {
        core.info(`skipping, JVM is already installed in ${process.env.JAVA_HOME}`)
      } else {
        await cs('java', ...jvmArg, ...jvmIndexArg, '-version')
        const csJavaHome = await cs('java-home', ...jvmArg, ...jvmIndexArg)
        core.exportVariable('JAVA_HOME', csJavaHome)
        core.addPath(path.join(csJavaHome, 'bin'))
      }
    })

    await core.group('Install Apps', async () => {
      const value = core.getInput('apps').trim()
      const apps: string[] = value.split(' ')
      if (value && apps.length) {
        const coursierBinDir = path.join(os.homedir(), 'cs', 'bin')
        core.exportVariable('COURSIER_BIN_DIR', coursierBinDir)
        core.addPath(coursierBinDir)
        await cs('install', '--contrib', ...apps)
      }
    })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    core.setFailed(msg)
  }
}

run()
