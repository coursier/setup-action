echo '::group::Install Coursier'
curl -fLo cs https://git.io/coursier-cli-linux &&
chmod +x cs &&
./cs
echo '::endgroup::'

echo '::group::Install JVM'
if [ "${{ inputs.jvm }}" ]; then
  ./cs java --env ${{ inputs.jvm }}
fi
./cs java-home
echo "JAVA_HOME=$(./cs java-home)" >> $GITHUB_ENV
echo '::endgroup::'

echo '::group::Install Apps'
if [ "${{ inputs.apps }}" ]; then
  export COURSIER_BIN_DIR=${{ github.action_path }}/apps
  echo "COURSIER_BIN_DIR=$COURSIER_BIN_DIR" >> $GITHUB_ENV
  echo "$COURSIER_BIN_DIR" >> $GITHUB_PATH
  ./cs install ${{ inputs.apps }}
fi
echo '::endgroup::'

echo "::set-output name=cs-version::$(./cs --version)"
