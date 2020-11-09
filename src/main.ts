import * as core from '@actions/core'
import * as cli from '@actions/exec'
import * as path from 'path'
import * as os from 'os'

async function cs(...args: string[]): Promise<string> {
  let output = ''
  await cli.exec('./cs', args.filter(Boolean), {
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString()
      }
    }
  })
  return output
}

async function run(): Promise<void> {
  try {
    core.startGroup('Install Coursier')
    await cli.exec('curl', ['-sfLo', 'cs', 'https://git.io/coursier-cli-linux'])
    await cli.exec('chmod', ['+x', './cs'])
    await cs('--help')
    core.setOutput('cs-version', await cs('--version'))
    core.endGroup()

    core.startGroup('Install JVM')
    let JVM = ''
    const jvmInput = core.getInput('jvm')
    if (jvmInput) {
      JVM = `--jvm ${jvmInput}`
    }
    if (!JVM && process.env.JAVA_HOME) {
      core.info(
        `skipping, JVM is already installed in ${process.env.JAVA_HOME}`
      )
    } else {
      await cs('java', JVM, '-version')
      const csJavaHome = await cs('java-home', JVM)
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
