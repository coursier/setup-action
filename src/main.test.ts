import { describe, it } from 'node:test'
import * as assert from 'node:assert/strict'
import * as path from 'node:path'

import {
  checkChecksumRequirement,
  checkExistingJavaHome,
  compareCoursierVersions,
  coursierDownloadUrl,
  getCoursierArchitecture,
  getReleaseTag,
  parseCustomRepositories,
  parseExtraJvmArgs,
  parseMirrors,
  quoteJavaToolOption,
  splitMilestone,
  useVirtusLabRepo,
  validateLauncher,
} from './main'
import pinnedChecksums from './checksums.json'

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
  // Fails the test on unexpected warnings
  const noWarning = (message: string): never => assert.fail(`unexpected warning: ${message}`)
  const parse = (input: string): string[] => parseExtraJvmArgs(input, noWarning)

  it('returns nothing for empty input', () => {
    assert.deepEqual(parse(''), [])
    assert.deepEqual(parse('  \n \n'), [])
  })

  it('adds the -J prefix when missing', () => {
    assert.deepEqual(parse('-Dfoo=bar -J-Dhttps.proxyHost=proxy.example.com'), [
      '-J-Dfoo=bar',
      '-J-Dhttps.proxyHost=proxy.example.com',
    ])
  })

  it('splits single-line input on any whitespace', () => {
    assert.deepEqual(parse('  -Da=1 \t-Db  '), ['-J-Da=1', '-J-Db'])
  })

  it('keeps values containing special characters', () => {
    assert.deepEqual(parse('-Dhttp.nonProxyHosts=localhost|*.example.com'), [
      '-J-Dhttp.nonProxyHosts=localhost|*.example.com',
    ])
    assert.deepEqual(parse('-Dfoo= -Dbar==b"\'z'), ['-J-Dfoo=', '-J-Dbar==b"\'z'])
  })

  it('accepts memory options', () => {
    assert.deepEqual(parse('-Xmx2g -J-Xms512m -Xss4m -Xmx1024 -Xmx2G -Xss1k -Xmx1t'), [
      '-J-Xmx2g',
      '-J-Xms512m',
      '-J-Xss4m',
      '-J-Xmx1024',
      '-J-Xmx2G',
      '-J-Xss1k',
      '-J-Xmx1t',
    ])
  })

  it('accepts -XX: options', () => {
    assert.deepEqual(
      parse(
        '-XX:+UseG1GC -J-XX:-UseAdaptiveSizePolicy -XX:MaxRAMPercentage=75 -XX:LogFile=/tmp/a.log',
      ),
      [
        '-J-XX:+UseG1GC',
        '-J-XX:-UseAdaptiveSizePolicy',
        '-J-XX:MaxRAMPercentage=75',
        '-J-XX:LogFile=/tmp/a.log',
      ],
    )
  })

  it('mixes properties and JVM options', () => {
    assert.deepEqual(parse('-Xmx2g -Dfoo=bar -XX:+UseSerialGC'), [
      '-J-Xmx2g',
      '-J-Dfoo=bar',
      '-J-XX:+UseSerialGC',
    ])
  })

  it('rejects other args', () => {
    assert.throws(() => parse('-Dfoo=bar --help'), /Invalid JVM argument: --help/)
    assert.throws(() => parse('-D1foo=bar'), /Invalid JVM argument/)
    assert.throws(() => parse('-Dfoo..bar=baz'), /Invalid JVM argument/)
    assert.throws(() => parse('-D'), /Invalid JVM argument/)
    assert.throws(() => parse('foo'), /Invalid JVM argument: foo/)
    assert.throws(() => parse('-J'), /Invalid JVM argument/)
    assert.throws(() => parse('-jar foo.jar'), /Invalid JVM argument: -jar/)
    assert.throws(() => parse('-javaagent:agent.jar'), /Invalid JVM argument/)
    assert.throws(() => parse('-J-agentlib:jdwp=transport=dt_socket'), /Invalid JVM argument/)
    assert.throws(() => parse('-cp foo'), /Invalid JVM argument: -cp/)
    assert.throws(() => parse('-version'), /Invalid JVM argument/)
    assert.throws(() => parse('-Xlog:gc'), /Invalid JVM argument/)
    assert.throws(() => parse('-Xint'), /Invalid JVM argument/)
    assert.throws(() => parse('-Xmx'), /Invalid JVM argument/)
    assert.throws(() => parse('-Xmx2gb'), /Invalid JVM argument/)
    assert.throws(() => parse('-Xmx-1g'), /Invalid JVM argument/)
    assert.throws(() => parse('-XX:'), /Invalid JVM argument/)
    assert.throws(() => parse('-XX:+'), /Invalid JVM argument/)
    assert.throws(() => parse('-XX:Foo'), /Invalid JVM argument/)
    assert.throws(() => parse('-XX:+Foo=1'), /Invalid JVM argument/)
    assert.throws(() => parse('-XXFoo'), /Invalid JVM argument/)
    assert.throws(() => parse('-J-J-Dfoo'), /Invalid JVM argument/)
  })

  it('takes one arg per line in multi-line input, allowing spaces in property values', () => {
    assert.deepEqual(parse('-Dfoo=a b  c\n\n  -J-Dbar=x\ty  \n-Xmx2g\r\n-XX:+UseG1GC\n-Dbaz\n'), [
      '-J-Dfoo=a b  c',
      '-J-Dbar=x\ty',
      '-J-Xmx2g',
      '-J-XX:+UseG1GC',
      '-J-Dbaz',
    ])
  })

  it('only allows spaces in property values', () => {
    assert.throws(() => parse('-Dfoo bar=a\n-Db'), /Invalid JVM argument: -Dfoo bar=a/)
    assert.throws(() => parse('-Xmx2g -Xms1g\n-Db'), /Invalid JVM argument: -Xmx2g -Xms1g/)
    assert.throws(() => parse('-XX:Foo=a b\n-Db'), /Invalid JVM argument/)
  })

  it('warns about multi-line input lines that look like several args', () => {
    const warnings: string[] = []
    assert.deepEqual(
      parseExtraJvmArgs('-Da=1 -Db=2\n-Dc=x -Xmx2g\n-Dd=x -J-Dy\n-De=a -b', m => warnings.push(m)),
      ['-J-Da=1 -Db=2', '-J-Dc=x -Xmx2g', '-J-Dd=x -J-Dy', '-J-De=a -b'],
    )
    assert.equal(warnings.length, 3)
    assert.match(warnings[0], /"-Da=1 -Db=2" is passed as a single argument/)
  })

  it('keeps the space-separated form for input that is a single line', () => {
    assert.deepEqual(parse('-Da=1 -Db=2'), ['-J-Da=1', '-J-Db=2'])
    assert.throws(() => parse('-Dfoo=a b'), /Invalid JVM argument: b/)
  })
})

describe('quoteJavaToolOption', () => {
  it('leaves simple args alone', () => {
    assert.equal(quoteJavaToolOption('-Dfoo=bar'), '-Dfoo=bar')
    assert.equal(quoteJavaToolOption('-Xmx2g'), '-Xmx2g')
    assert.equal(quoteJavaToolOption('-Dfoo=a|b*c'), '-Dfoo=a|b*c')
  })

  it('quotes args with whitespace or quotes', () => {
    assert.equal(quoteJavaToolOption('-Dfoo=a b'), '"-Dfoo=a b"')
    assert.equal(quoteJavaToolOption('-Dfoo=a\tb'), '"-Dfoo=a\tb"')
    assert.equal(quoteJavaToolOption("-Dfoo=it's"), `"-Dfoo=it's"`)
  })

  it('single-quotes double quotes', () => {
    assert.equal(quoteJavaToolOption('-Dfoo=a"b c'), `"-Dfoo=a"'"'"b c"`)
    assert.equal(quoteJavaToolOption('-Dfoo="x"'), `"-Dfoo="'"'"x"'"'""`)
  })
})

describe('parseCustomRepositories', () => {
  it('splits on pipes', () => {
    assert.deepEqual(parseCustomRepositories('https://a|https://b'), ['https://a', 'https://b'])
    assert.deepEqual(parseCustomRepositories('https://a'), ['https://a'])
  })

  it('trims entries', () => {
    assert.deepEqual(parseCustomRepositories(' https://a | ivy2Local '), ['https://a', 'ivy2Local'])
  })

  it('drops empty entries', () => {
    assert.deepEqual(parseCustomRepositories('https://a|'), ['https://a'])
    assert.deepEqual(parseCustomRepositories('|https://a'), ['https://a'])
    assert.deepEqual(parseCustomRepositories('a||b'), ['a', 'b'])
    assert.deepEqual(parseCustomRepositories('a| |b'), ['a', 'b'])
  })

  it('returns nothing for empty or blank input', () => {
    assert.deepEqual(parseCustomRepositories(''), [])
    assert.deepEqual(parseCustomRepositories('   '), [])
    assert.deepEqual(parseCustomRepositories('|'), [])
    assert.deepEqual(parseCustomRepositories('\n'), [])
  })

  it('splits on newlines', () => {
    assert.deepEqual(parseCustomRepositories('https://a\nhttps://b\n'), ['https://a', 'https://b'])
    assert.deepEqual(parseCustomRepositories('https://a\r\n\r\nhttps://b'), [
      'https://a',
      'https://b',
    ])
    assert.deepEqual(parseCustomRepositories('https://a|https://b\nhttps://c'), [
      'https://a',
      'https://b',
      'https://c',
    ])
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
        'setupActionMirror0.from=https://repo1.maven.org/maven2',
        'setupActionMirror0.to=https://mirror.example.com/maven2',
        'setupActionMirror1.from=https://repo.example.com/a',
        'setupActionMirror1.to=https://mirror.example.com/a',
      ],
    )
  })

  it('ignores comments and blank lines', () => {
    assert.deepEqual(parseMirrors('# comment\n\n  \n  a=b  \n  # another\nc=d\n'), [
      'setupActionMirror0.from=a',
      'setupActionMirror0.to=b',
      'setupActionMirror1.from=c',
      'setupActionMirror1.to=d',
    ])
  })

  it('only splits on the first =', () => {
    assert.deepEqual(parseMirrors('https://a/?x=1=https://b/?y=2'), [
      'setupActionMirror0.from=https://a/?x',
      'setupActionMirror0.to=1=https://b/?y=2',
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

describe('checkChecksumRequirement', () => {
  const checksums = { '2.1.26': { coursier: 'abc' } }

  it('accepts any version when not required', () => {
    assert.doesNotThrow(() => checkChecksumRequirement('2.1.25', false, checksums))
    assert.doesNotThrow(() => checkChecksumRequirement('nightly', false, checksums))
  })

  it('accepts pinned versions when required', () => {
    assert.doesNotThrow(() => checkChecksumRequirement('2.1.26', true, checksums))
  })

  it('rejects versions without pinned checksums when required', () => {
    assert.throws(() => checkChecksumRequirement('2.1.25', true, checksums), /2\.1\.25.*2\.1\.26/)
    assert.throws(() => checkChecksumRequirement('nightly', true, checksums), /nightly/)
  })

  it('accepts the versions of the actual checksum table when required', () => {
    for (const version of Object.keys(pinnedChecksums)) {
      assert.doesNotThrow(() => checkChecksumRequirement(version, true))
    }
  })
})

describe('checkExistingJavaHome', () => {
  const javaHome = path.join('/opt', 'jdk')
  const existing =
    (files: string[]): ((p: string) => boolean) =>
    (p: string): boolean =>
      files.includes(p)

  it('keeps a JAVA_HOME containing a java launcher', () => {
    const exists = existing([path.join(javaHome, 'bin', 'java')])
    assert.deepEqual(checkExistingJavaHome('', javaHome, 'linux', exists), { keep: true, javaHome })
  })

  it('looks for java.exe on Windows', () => {
    const exists = existing([path.join(javaHome, 'bin', 'java.exe')])
    assert.deepEqual(checkExistingJavaHome('', javaHome, 'win32', exists), { keep: true, javaHome })
    assert.deepEqual(checkExistingJavaHome('', javaHome, 'linux', exists), {
      keep: false,
      invalidJavaHome: javaHome,
    })
  })

  it('reports a JAVA_HOME without a java launcher', () => {
    assert.deepEqual(checkExistingJavaHome('', javaHome, 'linux', existing([])), {
      keep: false,
      invalidJavaHome: javaHome,
    })
  })

  it('installs a JVM when JAVA_HOME is unset or empty', () => {
    assert.deepEqual(checkExistingJavaHome('', undefined, 'linux', existing([])), { keep: false })
    assert.deepEqual(checkExistingJavaHome('', '', 'linux', existing([])), { keep: false })
  })

  it('ignores JAVA_HOME when the jvm input is set, without checking it', () => {
    const exists = (): boolean => assert.fail('should not check files')
    assert.deepEqual(checkExistingJavaHome('21', javaHome, 'linux', exists), { keep: false })
  })
})
