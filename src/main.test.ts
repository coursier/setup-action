import { describe, it } from 'node:test'
import * as assert from 'node:assert/strict'

import {
  compareCoursierVersions,
  coursierDownloadUrl,
  getCoursierArchitecture,
  getReleaseTag,
  parseExtraJvmArgs,
  parseMirrors,
  splitMilestone,
  useVirtusLabRepo,
  validateLauncher,
} from './main'

describe('splitMilestone', () => {
  it('splits milestone versions', () => {
    assert.deepEqual(splitMilestone('2.1.25-M3'), ['2.1.25', 3])
    assert.deepEqual(splitMilestone('2.1.25-M10'), ['2.1.25', 10])
  })

  it('sorts releases after all milestones', () => {
    assert.deepEqual(splitMilestone('2.1.25'), ['2.1.25', Number.MAX_SAFE_INTEGER])
  })
})

describe('compareCoursierVersions', () => {
  it('compares plain versions', () => {
    assert.equal(compareCoursierVersions('2.1.24', '2.1.25'), -1)
    assert.equal(compareCoursierVersions('2.1.25', '2.1.24'), 1)
    assert.equal(compareCoursierVersions('2.1.25', '2.1.25'), 0)
    assert.equal(compareCoursierVersions('2.1.9', '2.1.10'), -1)
  })

  it('sorts milestones before the corresponding release', () => {
    assert.equal(compareCoursierVersions('2.1.25-M3', '2.1.25'), -1)
    assert.equal(compareCoursierVersions('2.1.25', '2.1.25-M3'), 1)
  })

  it('compares milestone numbers numerically', () => {
    assert.equal(compareCoursierVersions('2.1.25-M3', '2.1.25-M10'), -1)
    assert.equal(compareCoursierVersions('2.1.25-M10', '2.1.25-M3'), 1)
    assert.equal(compareCoursierVersions('2.1.25-M3', '2.1.25-M3'), 0)
  })

  it('compares release parts before milestone numbers', () => {
    assert.equal(compareCoursierVersions('2.1.24', '2.1.25-M1'), -1)
    assert.equal(compareCoursierVersions('2.1.25-M1', '2.1.24'), 1)
    assert.equal(compareCoursierVersions('2.1.24-M9', '2.1.25-M1'), -1)
  })
})

describe('getReleaseTag', () => {
  it('prefixes versions with v', () => {
    assert.equal(getReleaseTag('2.1.26'), 'v2.1.26')
    assert.equal(getReleaseTag('2.1.25-M3'), 'v2.1.25-M3')
  })

  it('uses the nightly tag as is', () => {
    assert.equal(getReleaseTag('nightly'), 'nightly')
  })
})

describe('useVirtusLabRepo', () => {
  it('is used on macOS arm64 before 2.1.16', () => {
    assert.equal(useVirtusLabRepo('2.1.15', 'darwin', 'arm64'), true)
    assert.equal(useVirtusLabRepo('2.1.16-M1', 'darwin', 'arm64'), true)
    assert.equal(useVirtusLabRepo('2.1.16', 'darwin', 'arm64'), false)
    assert.equal(useVirtusLabRepo('2.1.24', 'darwin', 'arm64'), false)
  })

  it('is used on Linux arm64 before 2.1.25-M3', () => {
    assert.equal(useVirtusLabRepo('2.1.24', 'linux', 'arm64'), true)
    assert.equal(useVirtusLabRepo('2.1.25-M2', 'linux', 'arm64'), true)
    assert.equal(useVirtusLabRepo('2.1.25-M3', 'linux', 'arm64'), false)
    assert.equal(useVirtusLabRepo('2.1.25-M10', 'linux', 'arm64'), false)
    assert.equal(useVirtusLabRepo('2.1.25', 'linux', 'arm64'), false)
  })

  it('is never used for nightly', () => {
    assert.equal(useVirtusLabRepo('nightly', 'darwin', 'arm64'), false)
    assert.equal(useVirtusLabRepo('nightly', 'linux', 'arm64'), false)
  })

  it('is never used on x64 or Windows', () => {
    assert.equal(useVirtusLabRepo('2.1.0', 'darwin', 'x64'), false)
    assert.equal(useVirtusLabRepo('2.1.0', 'linux', 'x64'), false)
    assert.equal(useVirtusLabRepo('2.1.0', 'win32', 'arm64'), false)
  })
})

describe('getCoursierArchitecture', () => {
  it('maps Node architectures', () => {
    assert.equal(getCoursierArchitecture('x64'), 'x86_64')
    assert.equal(getCoursierArchitecture('arm64'), 'aarch64')
    assert.equal(getCoursierArchitecture('arm'), 'aarch64')
  })

  it('rejects unsupported architectures', () => {
    assert.throws(() => getCoursierArchitecture('ia32'), /does not have support for the ia32/)
  })
})

describe('validateLauncher', () => {
  it('accepts empty and valid values', () => {
    assert.equal(validateLauncher('launcher', ''), '')
    assert.equal(validateLauncher('launcher', '  '), '')
    assert.equal(validateLauncher('launcher', 'container'), 'container')
    assert.equal(validateLauncher('preferredLauncher', ' static '), 'static')
    assert.equal(validateLauncher('launcher', 'a1.b_c-d'), 'a1.b_c-d')
  })

  it('rejects invalid values', () => {
    assert.throws(() => validateLauncher('launcher', '../x'), /Invalid launcher value: \.\.\/x/)
    assert.throws(() => validateLauncher('preferredLauncher', '-x'), /Invalid preferredLauncher/)
    assert.throws(() => validateLauncher('launcher', 'a b'), /Invalid launcher/)
    assert.throws(() => validateLauncher('launcher', 'a/b'), /Invalid launcher/)
  })
})

describe('parseExtraJvmArgs', () => {
  it('returns nothing for empty input', () => {
    assert.deepEqual(parseExtraJvmArgs(''), [])
  })

  it('adds the -J prefix when missing', () => {
    assert.deepEqual(parseExtraJvmArgs('-Dfoo=bar -J-Dhttps.proxyHost=proxy.example.com'), [
      '-J-Dfoo=bar',
      '-J-Dhttps.proxyHost=proxy.example.com',
    ])
  })

  it('splits on any whitespace', () => {
    assert.deepEqual(parseExtraJvmArgs('  -Da=1\n\t-Db  '), ['-J-Da=1', '-J-Db'])
  })

  it('keeps values containing special characters', () => {
    assert.deepEqual(parseExtraJvmArgs('-Dhttp.nonProxyHosts=localhost|*.example.com'), [
      '-J-Dhttp.nonProxyHosts=localhost|*.example.com',
    ])
  })

  it('rejects non -D args', () => {
    assert.throws(() => parseExtraJvmArgs('-Xmx2g'), /Invalid JVM argument: -Xmx2g/)
    assert.throws(() => parseExtraJvmArgs('-J-Xmx2g'), /Invalid JVM argument: -J-Xmx2g/)
    assert.throws(() => parseExtraJvmArgs('-Dfoo=bar --help'), /Invalid JVM argument: --help/)
    assert.throws(() => parseExtraJvmArgs('-D1foo=bar'), /Invalid JVM argument/)
    assert.throws(() => parseExtraJvmArgs('-Dfoo..bar=baz'), /Invalid JVM argument/)
  })
})

describe('parseMirrors', () => {
  it('parses from=to lines', () => {
    assert.deepEqual(
      parseMirrors(
        'https://repo1.maven.org/maven2=https://mirror.example.com/maven2\n' +
          'https://repo.example.com/a = https://mirror.example.com/a',
      ),
      [
        'mirror0.from=https://repo1.maven.org/maven2',
        'mirror0.to=https://mirror.example.com/maven2',
        'mirror1.from=https://repo.example.com/a',
        'mirror1.to=https://mirror.example.com/a',
      ],
    )
  })

  it('ignores comments and blank lines', () => {
    assert.deepEqual(parseMirrors('# comment\n\n  \n  a=b  \n  # another\nc=d\n'), [
      'mirror0.from=a',
      'mirror0.to=b',
      'mirror1.from=c',
      'mirror1.to=d',
    ])
  })

  it('only splits on the first =', () => {
    assert.deepEqual(parseMirrors('https://a/?x=1=https://b/?y=2'), [
      'mirror0.from=https://a/?x',
      'mirror0.to=1=https://b/?y=2',
    ])
  })

  it('returns nothing for empty input', () => {
    assert.deepEqual(parseMirrors(''), [])
    assert.deepEqual(parseMirrors('# only a comment\n'), [])
  })

  it('rejects entries without =', () => {
    assert.throws(() => parseMirrors('a=b\nfoo'), /Invalid mirror entry \(expected from=to\): foo/)
  })

  it('rejects entries with an empty side', () => {
    assert.throws(() => parseMirrors('=b'), /Invalid mirror entry \(empty side\): =b/)
    assert.throws(() => parseMirrors('a = '), /Invalid mirror entry \(empty side\): a =/)
  })
})

describe('coursierDownloadUrl', () => {
  const coursierBase = 'https://github.com/coursier/coursier//releases/download'
  const virtusLabBase = 'https://github.com/VirtusLab/coursier-m1//releases/download'

  it('builds Linux URLs', () => {
    assert.equal(
      coursierDownloadUrl('2.1.26', 'linux', 'x64', ''),
      `${coursierBase}/v2.1.26/cs-x86_64-pc-linux.gz`,
    )
    assert.equal(
      coursierDownloadUrl('2.1.26', 'linux', 'arm64', ''),
      `${coursierBase}/v2.1.26/cs-aarch64-pc-linux.gz`,
    )
  })

  it('builds macOS URLs', () => {
    assert.equal(
      coursierDownloadUrl('2.1.26', 'darwin', 'arm64', ''),
      `${coursierBase}/v2.1.26/cs-aarch64-apple-darwin.gz`,
    )
    assert.equal(
      coursierDownloadUrl('2.1.26', 'darwin', 'x64', ''),
      `${coursierBase}/v2.1.26/cs-x86_64-apple-darwin.gz`,
    )
  })

  it('builds Windows URLs', () => {
    assert.equal(
      coursierDownloadUrl('2.1.26', 'win32', 'x64', ''),
      `${coursierBase}/v2.1.26/cs-x86_64-pc-win32.zip`,
    )
    assert.equal(
      coursierDownloadUrl('2.1.26', 'win32', 'arm64', 'jvm'),
      `${coursierBase}/v2.1.26/cs-aarch64-pc-win32-jvm.zip`,
    )
  })

  it('appends the launcher suffix', () => {
    assert.equal(
      coursierDownloadUrl('2.1.26', 'linux', 'x64', 'container'),
      `${coursierBase}/v2.1.26/cs-x86_64-pc-linux-container.gz`,
    )
    assert.equal(
      coursierDownloadUrl('2.1.26', 'darwin', 'arm64', 'static'),
      `${coursierBase}/v2.1.26/cs-aarch64-apple-darwin-static.gz`,
    )
  })

  it('uses the nightly tag', () => {
    assert.equal(
      coursierDownloadUrl('nightly', 'linux', 'arm64', ''),
      `${coursierBase}/nightly/cs-aarch64-pc-linux.gz`,
    )
  })

  it('uses the VirtusLab repository for older arm64 versions', () => {
    assert.equal(
      coursierDownloadUrl('2.1.24', 'linux', 'arm64', ''),
      `${virtusLabBase}/v2.1.24/cs-aarch64-pc-linux.gz`,
    )
    assert.equal(
      coursierDownloadUrl('2.1.15', 'darwin', 'arm64', ''),
      `${virtusLabBase}/v2.1.15/cs-aarch64-apple-darwin.gz`,
    )
    assert.equal(
      coursierDownloadUrl('2.1.24', 'linux', 'x64', ''),
      `${coursierBase}/v2.1.24/cs-x86_64-pc-linux.gz`,
    )
  })

  it('rejects unknown platforms and architectures', () => {
    assert.throws(() => coursierDownloadUrl('2.1.26', 'freebsd', 'x64', ''), /Unknown/)
    assert.throws(() => coursierDownloadUrl('2.1.26', 'linux', 'ia32', ''), /ia32/)
  })
})
