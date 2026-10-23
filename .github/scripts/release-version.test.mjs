import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveReleaseVersion } from './release-version.mjs'

test('uses the manual suffix and normalizes the fork registry namespace', () => {
  assert.deepEqual(resolveReleaseVersion('v0.36.0', '1', 'BruceKhetta/logicle'), {
    version: '0.36.0-nh-1',
    release_tag: 'v0.36.0-nh-1',
    image: 'ghcr.io/brucekhetta/logicle',
  })
})

test('accepts tags without v, upstream prereleases and descriptive fork suffixes', () => {
  assert.equal(resolveReleaseVersion('0.36.0', 'satellite-fix', 'BruceKhetta/logicle').version, '0.36.0-nh-satellite-fix')
  assert.equal(resolveReleaseVersion('v0.36.0-b1', 'rc.2', 'BruceKhetta/logicle').version, '0.36.0-b1-nh-rc.2')
})

test('rejects missing, malformed or already forked upstream versions', () => {
  for (const tag of [undefined, '', 'latest', 'v0.36', 'v00.36.0', 'v0.36.0-nh-1', 'v0.36.0+build', 'v0.36.0\nimage=other', 'v0.36.0\n']) {
    assert.throws(() => resolveReleaseVersion(tag, '1', 'BruceKhetta/logicle'))
  }
})

test('rejects unsafe suffixes before constructing tags or Actions outputs', () => {
  for (const suffix of [undefined, '', ' hello', 'Hello', 'one/two', '1_2', '-1', '1..2', '1\nimage=other', '1\n', '$(id)', "1';exit 1", '1.01']) {
    assert.throws(() => resolveReleaseVersion('v0.36.0', suffix, 'BruceKhetta/logicle'))
  }
})

test('rejects non-SemVer numeric upstream prerelease identifiers', () => {
  assert.throws(() => resolveReleaseVersion('v0.36.0-rc.01', '1', 'BruceKhetta/logicle'))
})

test('enforces the Docker tag length limit', () => {
  assert.throws(() => resolveReleaseVersion('v0.36.0', 'a'.repeat(128), 'BruceKhetta/logicle'))
})

test('rejects invalid repository paths', () => {
  for (const repository of [undefined, '', 'logicle', 'owner/repo/other', 'owner/repo\nversion=other', 'owner/repo\n']) {
    assert.throws(() => resolveReleaseVersion('v0.36.0', '1', repository))
  }
})
