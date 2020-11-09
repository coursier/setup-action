import * as core from '@actions/core'
import * as cli from '@actions/exec'
import * as path from 'path'
import * as os from 'os'

async function run(): Promise<void> {
  try {
    core.startGroup('Install Coursier')
    await cli.exec('curl', ['-sfLo', 'cs', 'https://git.io/coursier-cli-linux'])
    await cli.exec('chmod', ['+x', './cs'])
    await cli.exec('./cs', ['--help'])
    let csVersion = ''
    await cli.exec('./cs', ['--version'], {
      listeners: {
        stdout: (data: Buffer) => {
          csVersion += data.toString()
        }
      }
    })
    core.setOutput('cs-version', csVersion)
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
      await cli.exec('./cs', ['java', JVM, '-version'])
      core.exportVariable('JAVA_HOME', './cs java-home $JVM') // TODO
      core.addPath('$(./cs java-home $JVM)/bin') // TODO
    }
    core.endGroup()

    core.startGroup('Install Apps')
    const apps: string[] = core.getInput('apps').split(' ')
    if (apps.length) {
      const coursierBinDir = path.join(os.homedir(), 'cs-bin')
      core.exportVariable('COURSIER_BIN_DIR', coursierBinDir)
      core.addPath(coursierBinDir)
      await cli.exec('./cs', ['install', 'cs'].concat(apps))
    }
    core.endGroup()
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
