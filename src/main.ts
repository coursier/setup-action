import * as core from '@actions/core'
import * as cli from '@actions/exec'
import * as tc from '@actions/tool-cache'
import * as path from 'path'
import * as os from 'os'

async function cs(...args: string[]): Promise<string> {
  let csCached = tc.find('cs', 'latest')
  if (!csCached) {
    const csBinary = await tc.downloadTool('https://git.io/coursier-cli-linux')
    await cli.exec('chmod', ['+x', csBinary])
    csCached = await tc.cacheFile(csBinary, 'cs', 'cs', 'latest')
    core.addPath(csCached)
  }
  let output = ''
  await cli.exec(csCached, args.filter(Boolean), {
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString()
      }
    }
  })
  return output.trim()
}

async function run(): Promise<void> {
  try {
    await core.group('Install Coursier', async () => {
      const version = await cs('--version')
      core.setOutput('cs-version', version)
    })

    core.startGroup('Install JVM')
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
    core.endGroup()

    core.startGroup('Install Apps')
    const apps: string[] = core.getInput('apps').split(' ')
    if (apps.length) {
      const coursierBinDir = path.join(os.homedir(), 'cs-bin')
      core.exportVariable('COURSIER_BIN_DIR', coursierBinDir)
      core.addPath(coursierBinDir)
      await cs('install', 'cs', ...apps)
    }
    core.endGroup()
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
