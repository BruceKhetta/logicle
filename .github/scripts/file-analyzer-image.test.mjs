import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveFileAnalyzerImage } from './file-analyzer-image.mjs'

const sha = 'a'.repeat(40)

test('keeps analyzer tags in the same Logicle package and normalizes casing', () => {
  assert.deepEqual(resolveFileAnalyzerImage('BruceKhetta/logicle', sha, '1.0.0'), {
    image: 'ghcr.io/brucekhetta/logicle',
    version_tag: 'ghcr.io/brucekhetta/logicle:mcp-file-analyzer-1.0.0',
  })
})

test('requires an explicit release version and does not generate commit or latest tags', () => {
  assert.throws(() => resolveFileAnalyzerImage('BruceKhetta/logicle', sha))
  assert.throws(() => resolveFileAnalyzerImage('BruceKhetta/logicle', sha, ''))
  const result = resolveFileAnalyzerImage('BruceKhetta/logicle', sha, '1.0.0')
  assert.equal(result.sha_tag, undefined)
  assert.ok(!Object.values(result).some((value) => value.endsWith(':latest')))
})

test('accepts an explicit prerelease without changing the registry package', () => {
  assert.equal(
    resolveFileAnalyzerImage('BruceKhetta/logicle', sha, '1.0.0-rc.1').version_tag,
    'ghcr.io/brucekhetta/logicle:mcp-file-analyzer-1.0.0-rc.1'
  )
})

test('rejects a different repository or unsafe repository context', () => {
  for (const repo of [
    undefined,
    '',
    'other/logicle',
    'BruceKhetta/mcp-file-analyzer',
    'BruceKhetta/logicle\nimage=other',
  ]) {
    assert.throws(() => resolveFileAnalyzerImage(repo, sha, '1.0.0'))
  }
})

test('requires a full hexadecimal commit SHA', () => {
  for (const value of [undefined, '', 'main', 'abc1234', 'A'.repeat(40), `${sha}\n`]) {
    assert.throws(() => resolveFileAnalyzerImage('BruceKhetta/logicle', value, '1.0.0'))
  }
})

test('rejects version injection and malformed tags', () => {
  for (const version of [
    null,
    'latest',
    'v1.0.0',
    '01.0.0',
    '1.0',
    '1.0.0\nimage=other',
    '1.0.0\n',
    '$(id)',
    '1.0.0-rc/x',
  ]) {
    assert.throws(() => resolveFileAnalyzerImage('BruceKhetta/logicle', sha, version))
  }
  assert.throws(() =>
    resolveFileAnalyzerImage('BruceKhetta/logicle', sha, `1.0.0-${'a'.repeat(128)}`)
  )
})
