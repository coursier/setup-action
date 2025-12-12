import * as cli from '@actions/exec'
import * as core from '@actions/core'
import * as os from 'os'
import * as path from 'path'
import * as tc from '@actions/tool-cache'

// would have preferred to use coursier.core.Version here,
// but coursier is not published on npm
import { compareVersions } from 'compare-versions'

const mainRepoDefaultVersion = '2.1.25-M19'
const virtusLabM1DefaultVersion = '2.1.25-M19'

const defaultUseMainRepo = process.arch === 'x64' || process.platform == 'darwin'
const csVersion =
  core.getInput('version') ||
  (defaultUseMainRepo ? mainRepoDefaultVersion : virtusLabM1DefaultVersion)
const useMainRepo =
  process.arch === 'x64' ||
  (process.platform == 'darwin' && compareVersions(csVersion, '2.1.16') >= 0)
const coursierBinariesGithubRepository = useMainRepo
  ? 'https://github.com/coursier/coursier/'
  : 'https://github.com/VirtusLab/coursier-m1/'

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

async function downloadCoursier(): Promise<string> {
  const architecture = getCoursierArchitecture(process.arch)
  const baseUrl = `${coursierBinariesGithubRepository}/releases/download/v${csVersion}/cs-${architecture}`
  let csBinary = ''
  switch (process.platform) {
    case 'linux': {
      const useContainerImageInput = core.getBooleanInput('useContainerImage')
      const url = useContainerImageInput
        ? `${baseUrl}-pc-linux-container.gz`
        : `${baseUrl}-pc-linux.gz`
      console.log(`Downloading ${url}`)
      const guid = await tc.downloadTool(url)
      const archive = `${guid}.gz`
      await cli.exec('mv', [guid, archive])
      csBinary = archive
      break
    }
    case 'darwin': {
      const url = `${baseUrl}-apple-darwin.gz`
      console.log(`Downloading ${url}`)
      const guid = await tc.downloadTool(url)
      const archive = `${guid}.gz`
      await cli.exec('mv', [guid, archive])
      csBinary = archive
      break
    }
    case 'win32': {
      const url = `${baseUrl}-pc-win32.zip`
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
  const previous = tc.find('cs', csVersion)
  if (previous) {
    core.addPath(previous)
  } else {
    const csBinary = await downloadCoursier()
    const binaryName = process.platform === 'win32' ? 'cs.exe' : 'cs'
    const csCached = await tc.cacheFile(csBinary, binaryName, 'cs', csVersion)
    core.addPath(csCached)
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

async function run(): Promise<void> {
  try {
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
