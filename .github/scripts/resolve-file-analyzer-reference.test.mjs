import assert from 'node:assert/strict'
import test from 'node:test'
import { readAnalyzerReference, pinAnalyzerReference } from './resolve-file-analyzer-reference.mjs'

const repository = 'ghcr.io/brucekhetta/logicle'
const version = `${repository}:mcp-file-analyzer-1.0.0`
const digest = `sha256:${'a'.repeat(64)}`

test('reads the released version from the app Dockerfile', () => {
  assert.equal(
    readAnalyzerReference(`# comment\nARG FILE_ANALYZER_IMAGE=${version}\nFROM ...\n`),
    version
  )
})

test('accepts an explicitly pinned digest or version prerelease', () => {
  const reference = `${repository}@${digest}`
  assert.equal(readAnalyzerReference(`ARG FILE_ANALYZER_IMAGE=${reference}\n`), reference)
  assert.equal(
    readAnalyzerReference(`ARG FILE_ANALYZER_IMAGE=${version}-rc.1\n`),
    `${version}-rc.1`
  )
})

test('rejects missing or ambiguous image defaults instead of building a fallback', () => {
  for (const dockerfile of [
    '',
    'ARG FILE_ANALYZER_IMAGE\n',
    `ARG FILE_ANALYZER_IMAGE=${version}\nARG FILE_ANALYZER_IMAGE=${version}\n`,
  ]) {
    assert.throws(() => readAnalyzerReference(dockerfile))
  }
})

test('rejects mutable latest, commit tags, foreign packages and argument expansion', () => {
  for (const reference of [
    `${repository}:latest`,
    `${repository}:mcp-file-analyzer-latest`,
    `${repository}:mcp-file-analyzer-sha-${'a'.repeat(40)}`,
    'ghcr.io/other/logicle:mcp-file-analyzer-1.0.0',
    '${ANALYZER_IMAGE}',
    `${version};echo`,
  ]) {
    assert.throws(() => readAnalyzerReference(`ARG FILE_ANALYZER_IMAGE=${reference}\n`))
  }
})

test('pins the manifest index digest rather than an individual architecture digest', () => {
  assert.equal(
    pinAnalyzerReference(version, { digest, manifests: [{ digest: `sha256:${'b'.repeat(64)}` }] }),
    `${repository}@${digest}`
  )
})

test('rejects invalid registry replies and mismatched preconfigured digests', () => {
  for (const value of [undefined, '', 'sha256:abc', `${digest}\nimage=other`]) {
    assert.throws(() => pinAnalyzerReference(version, { digest: value }))
  }
  assert.throws(() => pinAnalyzerReference(`${repository}@sha256:${'b'.repeat(64)}`, { digest }))
})

// Exercise the CI entrypoint against a fake registry client: no Docker daemon or
// network is needed to prove that resolving is read-only and fails closed.
test('CI entrypoint resolves the published image and never builds a fallback', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const { spawnSync } = await import('node:child_process')
  const cache = path.resolve('.cache')
  fs.mkdirSync(cache, { recursive: true })
  const temporary = fs.mkdtempSync(path.join(cache, 'analyzer-resolution-'))
  try {
    const docker = path.join(temporary, 'docker')
    const output = path.join(temporary, 'output')
    const captured = path.join(temporary, 'reference')
    const configured = readAnalyzerReference(fs.readFileSync('Dockerfile', 'utf8'))
    const registryDigest = configured.split('@')[1] ?? digest
    fs.writeFileSync(
      docker,
      `#!/bin/sh
if [ "$1 $2 $3" != "buildx imagetools inspect" ]; then exit 9; fi
printf '%s' "$4" > "$ANALYZER_TEST_REFERENCE"
printf '%s' '{"digest":"${registryDigest}"}'
`,
      { mode: 0o755 }
    )
    const run = () =>
      spawnSync(process.execPath, ['.github/scripts/resolve-file-analyzer-reference.mjs'], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: temporary,
          GITHUB_OUTPUT: output,
          ANALYZER_TEST_REFERENCE: captured,
        },
      })
    const success = run()
    assert.equal(success.status, 0, success.stderr)
    assert.equal(fs.readFileSync(output, 'utf8'), `image=${repository}@${registryDigest}\n`)
    assert.equal(fs.readFileSync(captured, 'utf8'), configured)
    fs.unlinkSync(output)
    fs.writeFileSync(docker, '#!/bin/sh\nprintf "manifest not found" >&2\nexit 1\n', {
      mode: 0o755,
    })
    const failure = run()
    assert.notEqual(failure.status, 0)
    assert.match(failure.stderr, /Publish it with the manual file-analyzer workflow first/)
    assert.equal(fs.existsSync(output), false)
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true })
  }
})
