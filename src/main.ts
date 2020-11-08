import * as core from '@actions/core'

async function run(): Promise<void> {
  try {
    // echo '::group::Install Coursier'
    // curl -sfLo cs https://git.io/coursier-cli-linux
    // chmod +x cs
    // ./cs --help
    // echo "::set-output name=cs-version::$(./cs --version)"
    // echo '::endgroup::'

    // echo '::group::Install JVM'
    // JVM=""
    // if [ "${{ inputs.jvm }}" ]; then
    //     JVM="--jvm ${{ inputs.jvm }}"
    // fi
    // if [ -z "$JVM" ] && [ "$JAVA_HOME" ]; then
    //     echo "skipping, JVM is already installed in $JAVA_HOME"
    // else
    //     ./cs java $JVM -version
    //     echo "JAVA_HOME=$(./cs java-home $JVM)" >> $GITHUB_ENV
    //     echo "$(./cs java-home $JVM)/bin" >> $GITHUB_PATH
    // fi
    // echo '::endgroup::'

    // echo '::group::Install Apps'
    // if [ "${{ inputs.apps }}" ]; then
    //     export COURSIER_BIN_DIR=${{ github.action_path }}/apps
    //     echo "COURSIER_BIN_DIR=$COURSIER_BIN_DIR" >> $GITHUB_ENV
    //     echo "$COURSIER_BIN_DIR" >> $GITHUB_PATH
    //     ./cs install cs ${{ inputs.apps }}
    // fi
    // echo '::endgroup::'
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
