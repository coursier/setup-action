echo '::group::Install Coursier'
curl -fLo cs https://git.io/coursier-cli-linux &&
chmod +x cs
echo "::set-output name=cs-version::$(./cs --version)"
echo '::endgroup::'

echo '::group::Install JVM'
JVM=""
if [ "${{ inputs.jvm }}" ]; then
    JVM="--jvm ${{ inputs.jvm }}"
fi
if [ -z "$JVM" ] && [ "$JAVA_HOME" ]; then
    echo "skipping, JVM is already installed in $JAVA_HOME"
else
    ./cs java $JVM -version
fi
echo "JAVA_HOME=$(./cs java-home $JVM)" >> $GITHUB_ENV
echo '::endgroup::'

echo '::group::Install Apps'
if [ "${{ inputs.apps }}" ]; then
    COURSIER_BIN_DIR=${{ github.action_path }}/apps
    echo "COURSIER_BIN_DIR=$COURSIER_BIN_DIR" >> $GITHUB_ENV
    echo "$COURSIER_BIN_DIR" >> $GITHUB_PATH
    ./cs install --dir $COURSIER_BIN_DIR ${{ inputs.apps }}
fi
echo '::endgroup::'
