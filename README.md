# Coursier setup GitHub Action

[![Test](https://github.com/coursier/setup-action/actions/workflows/test.yml/badge.svg)](https://github.com/coursier/setup-action/actions/workflows/test.yml)

A GitHub Action that installs [Coursier](https://get-coursier.io), then uses it to install a JVM and JVM / Scala command-line tools such as sbt, Scala CLI, Bloop or scalafmt.

```yml
steps:
  - uses: actions/checkout@v7
  - uses: coursier/setup-action@v3
    with:
      jvm: temurin:21
      apps: sbt
  - run: sbt test
```

## Features

- Runs on Linux, macOS and Windows, on both x64 and ARM64 runners
- Installs [any JVM](https://get-coursier.io/docs/cli-java.html#jvm-index) available from the Coursier JVM index
- Installs sbt, Scala CLI, Bloop, scalafmt and other apps from the [Coursier app channels](https://github.com/coursier/apps)
- Works with private repositories, mirrors and HTTP proxies

## What the action does

1. **Installs Coursier** and adds the `cs` launcher to the `PATH`.
2. **Installs a JVM**, sets `JAVA_HOME` and adds the JVM's `bin` directory to the `PATH`.
   If the `jvm` input is empty and `JAVA_HOME` is already set (for example by [actions/setup-java](https://github.com/actions/setup-java)), this step is skipped and the existing JVM is used.
   If the `jvm` input is empty and no `JAVA_HOME` is set, Coursier's default JVM is installed.
3. **Installs apps** with `cs install`, into `~/cs/bin`. That directory is added to the `PATH` and exported as `COURSIER_BIN_DIR`.

## Inputs

All inputs are optional.

| Input | Default | Description |
| --- | --- | --- |
| `jvm` | | JVM to install, such as `21`, `temurin:21` or `graalvm-community:25`. Run `cs java --available` to list valid values. See [above](#what-the-action-does) for what happens when it is empty. |
| `jvm-index` | | URL of a custom [JVM index](https://get-coursier.io/docs/cli-java.html#jvm-index), as in `cs java --available --jvm-index https://url/of/your/index.json`. The Coursier JVM index is used when empty. |
| `apps` | `sbtn` | Whitespace- or newline-separated list of apps to install, from the [main and contrib channels](https://github.com/coursier/apps). Set it to `''` to install no apps. |
| `version` | a recent release | Coursier version to install, such as `2.1.25`. Use `nightly` for the latest [nightly build](https://github.com/coursier/coursier/releases/tag/nightly). Only the launchers of the default version are checked against pinned checksums, see `requireChecksum`. |
| `customRepositories` | | Pipe-separated (`\|`) list of extra [repositories](https://get-coursier.io/docs/other-repositories) passed to every `cs` command. |
| `disableDefaultRepos` | `false` | Set to `true` to pass `--no-default` to every `cs` command, so that only `customRepositories` are used. |
| `mirrors` | | Newline-separated list of `from=to` [mirrors](https://get-coursier.io/docs/other-mirrors). See [Repositories and mirrors](#repositories-and-mirrors). |
| `extraJvmArgs` | | Space-separated list of `-D` Java properties passed to every `cs` command, such as `-Dhttps.proxyHost=proxy.example.com -Dhttps.proxyPort=8080`. The `-J` prefix is added automatically. |
| `launcher` | | Coursier launcher to use. See [Coursier launchers](#coursier-launchers). |
| `preferredLauncher` | | Like `launcher`, but falls back to the default launcher if the requested one isn't available. See [Coursier launchers](#coursier-launchers). |
| `requireChecksum` | `false` | Set to `true` to fail unless the Coursier launcher can be checked against a SHA-256 checksum pinned in the action. Checksums are pinned only for the default version, from launchers whose [build provenance attestation](https://github.com/coursier/coursier/attestations) was verified, so `version` must be empty or set to that version. |
| `useContainerImage` | `false` | **Deprecated**, use `launcher: container` instead. |

## Outputs

| Output | Description |
| --- | --- |
| `cs-version` | Version of the installed Coursier, as reported by `cs version`. With `version: nightly`, this is the actual version of the nightly build, not `nightly`. |
| `java-home` | `JAVA_HOME` in effect after the action: the JVM installed by Coursier, or the pre-existing `JAVA_HOME` when the `jvm` input is empty and `JAVA_HOME` was already set. |
| `cs-bin-dir` | Directory the apps were installed to, also exported as `COURSIER_BIN_DIR`. Only set when apps are installed: when `apps` is empty, it evaluates to an empty string. |

## Examples

### Specific JVM and apps

```yml
steps:
  - uses: actions/checkout@v7
  - uses: coursier/setup-action@v3
    with:
      jvm: temurin:17
      apps: sbt sbtn bloop scalafmt
```

### Scala CLI

```yml
steps:
  - uses: actions/checkout@v7
  - uses: coursier/setup-action@v3
    with:
      jvm: temurin:21
      apps: scala-cli
  - run: scala-cli test .
```

### Use a JVM installed by another action

When `jvm` is empty and `JAVA_HOME` is set, the action keeps the existing JVM:

```yml
steps:
  - uses: actions/checkout@v7
  - uses: actions/setup-java@v6
    with:
      distribution: temurin
      java-version: 21
  - uses: coursier/setup-action@v3
    with:
      apps: sbt
```

### Nightly Coursier

```yml
steps:
  - uses: actions/checkout@v7
  - uses: coursier/setup-action@v3
    with:
      version: nightly
```

### Corporate network

```yml
steps:
  - uses: actions/checkout@v7
  - uses: coursier/setup-action@v3
    with:
      jvm: temurin:21
      jvm-index: https://packages.corp.com/jvm-index.json
      apps: sbtn bloop
      disableDefaultRepos: true
      customRepositories: https://packages.corp.com/maven
      mirrors: |
        https://repo1.maven.org/maven2=https://packages.corp.com/maven
      extraJvmArgs: -Dhttps.proxyHost=proxy.corp.com -Dhttps.proxyPort=8080
```

## Repositories and mirrors

`customRepositories` and `disableDefaultRepos` change the repositories passed on the command line to every `cs` command the action runs. Some apps declare their own repositories in their app descriptor, and these options can't override those.

`mirrors` works at a lower level: before any `cs` command runs, entries are written to a mirror file owned by the action (under `$RUNNER_TEMP`), and apply to every repository Coursier sees, including the ones declared by app descriptors. The path of that file is exported as `COURSIER_EXTRA_MIRRORS`, so that Coursier-based tools in later steps of the job, such as sbt, Mill or Scala CLI, use these mirrors too.

Your own Coursier mirror configuration (`mirror.properties` in the Coursier config directory, or `COURSIER_MIRRORS`) is left untouched and still applies. If `COURSIER_EXTRA_MIRRORS` is already set, the mirrors of that file are copied into the action's file, as Coursier only accepts a single file there.

Each line of `mirrors` is a `from=to` entry. The `from` side can be a comma-separated list of URLs. Empty lines and lines starting with `#` are ignored.

```yml
mirrors: |
  # Maven Central and its Google mirror both go through the corporate proxy
  https://repo1.maven.org/maven2,https://maven-central.storage-download.googleapis.com/maven2=https://packages.corp.com/maven
```

## Coursier launchers

Coursier is distributed as several launchers. By default, the action installs the native launcher, which doesn't need a JVM. On Windows ARM64, where there is no native launcher, the default is a JVM-based distribution (`cs-aarch64-pc-win32-jvm.zip`) that bundles its own Java runtime.

Use `launcher` to pick another one:

| `launcher` | Launcher installed |
| --- | --- |
| (empty) | Default native launcher |
| `container`, `compat`, `static`, … | Native launcher flavor, such as `cs-x86_64-pc-linux-container` |
| `thin` or `jvm` | Thin JVM launcher. Requires Java to be installed beforehand. |
| `assembly` | Assembly (fat JAR) launcher. Requires Java to be installed beforehand. |

The action fails if the requested launcher isn't available for the Coursier version and platform. Not all flavors are published for every platform, so use `preferredLauncher` instead when you want a flavor where it exists and the default launcher elsewhere. If the download of the flavored launcher returns a 4xx HTTP error, the action logs a warning and installs the default launcher instead. `preferredLauncher` only accepts native launcher flavors, and can't be set together with `launcher`.

```yml
steps:
  - uses: coursier/setup-action@v3
    with:
      preferredLauncher: static
```

## Caching

This action works well with the official Coursier [cache-action](https://github.com/coursier/cache-action), which caches downloaded dependencies:

```yml
steps:
  - uses: actions/checkout@v7
  - uses: coursier/cache-action@v8
  - uses: coursier/setup-action@v3
```

## Development

```sh
npm ci
npm run all   # type-check, check formatting, lint, and bundle to dist/
```

`dist/` is rebuilt by CI once changes land on `main`, so pull requests should not include changes to it.

## License

[MIT](LICENSE.md)
