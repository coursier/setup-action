import * as core from '@actions/core'
import * as cli from '@actions/exec'
import * as tc from '@actions/tool-cache'
import * as path from 'path'
import * as os from 'os'

const coursierVersionSpec = `^2.0`

async function execOutput(cmd: string, ...args: string[]): Promise<string> {
  let output = ''
  const options = {
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString()
      }
    }
  }
  await cli.exec(cmd, args.filter(Boolean), options)
  return output.trim()
}

async function downloadCoursier(): Promise<string> {
  let csBinary = ''
  switch (process.platform) {
    case 'linux':
      csBinary = await tc.downloadTool('https://git.io/coursier-cli-linux')
      break
    case 'darwin':
      csBinary = await tc.downloadTool('https://git.io/coursier-cli-macos')
      break
    case 'win32': {
      const guid = await tc.downloadTool('https://git.io/coursier-cli-windows-exe')
      const exe = `${guid}.exe`
      await cli.exec('mv', [guid, exe])
      csBinary = exe
      break
    }
    default:
      core.setFailed(`Unknown process.platform: ${process.platform}`)
  }
  if (!csBinary) core.setFailed(`Couldn't download Coursier`)
  await cli.exec('chmod', ['+x', csBinary])
  return csBinary
}

async function cs(...args: string[]): Promise<string> {
  if (!tc.find('cs', coursierVersionSpec)) {
    const csBinary = await downloadCoursier()
    const version = await execOutput(csBinary, '--version')
    // const binaryName = process.platform == 'win32' ? 'cs.exe' : 'cs'
    const csCached = await tc.cacheFile(csBinary, 'cs', 'cs', version)
    await cli.exec('ls', ['-al', csCached])
    core.addPath(csCached)
  }
  return execOutput('cs', ...args)
}

async function run(): Promise<void> {
  try {
    await core.group('Install Coursier', async () => {
      const version = await cs('--version')
      core.setOutput('cs-version', version)
    })

    await core.group('Install JVM', async () => {
      const jvmInput = core.getInput('jvm')
      const jvmArg = jvmInput ? ['--jvm', jvmInput] : []
      if (!jvmInput && process.env.JAVA_HOME) {
        core.info(`skipping, JVM is already installed in ${process.env.JAVA_HOME}`)
      } else {
        await cs('java', ...jvmArg, '-version')
        const csJavaHome = await cs('java-home', ...jvmArg)
        core.exportVariable('JAVA_HOME', csJavaHome)
        core.addPath(path.join(csJavaHome, 'bin'))
      }
    })

    await core.group('Install Apps', async () => {
      const apps: string[] = core.getInput('apps').split(' ')
      if (apps.length) {
        const coursierBinDir = path.join(os.homedir(), 'cs-bin')
        core.exportVariable('COURSIER_BIN_DIR', coursierBinDir)
        core.addPath(coursierBinDir)
        await cs('install', ...apps)
      }
    })
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
