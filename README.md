# Coursier setup GitHub Action

A GitHub Action to install Coursier and use it to install Java and Scala CLI tools.

It can be useful if you want to install a specific version of JVM or use a build tool like `mill` or `seed`.

Inspired by [olafurpg/setup-scala](https://github.com/olafurpg/setup-scala) and the blog post [Single command Scala setup](https://alexarchambault.github.io/posts/2020-09-21-cs-setup.html) by Alex Archambault (author of Coursier).

## Inputs

- `jvm` (optional): JVM to install
  - one of the options from `cs java --available`.
  - if left empty either the existing JVM will be used or Coursier will install its default JVM.
- `apps` (optional): Scala apps to install (`sbtn` by default)
  - space separated list of app names (from the [main channel](https://github.com/coursier/apps))

## Outputs

- `cs-version`: version of the installed Coursier (should be the latest available)

## Caching

This action should work well with the official Coursier [cache-action](https://github.com/coursier/cache-action). For example:

```yml
  steps:
    - uses: actions/checkout@v2
    - uses: laughedelic/coursier-setup@v1
    - uses: coursier/cache-action@v5
```
