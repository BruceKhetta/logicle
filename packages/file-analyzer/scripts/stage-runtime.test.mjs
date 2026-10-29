import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import test from 'node:test'
import { stageRuntime } from './stage-runtime.mjs'

const root = process.cwd()
const cache = path.join(root, '.cache')
fs.mkdirSync(cache, { recursive: true })

test('stages an independent runtime with working native Sharp and no host symlinks', async () => {
  const temporary = fs.mkdtempSync(path.join(cache, 'analyzer-runtime-'))
  try {
    const bundleFile = path.join(temporary, 'test.mjs')
    fs.writeFileSync(bundleFile, 'export const fixture = true\n')
    const destination = path.join(temporary, 'runtime')
    const packages = stageRuntime({ destination, bundleFile, projectRoot: root })
    assert.ok(packages.includes('sharp'))
    assert.ok(!packages.includes('vite'))
    assert.equal(
      fs.readFileSync(path.join(destination, 'mcp-file-analyzer.mjs'), 'utf8'),
      'export const fixture = true\n'
    )
    function verify(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        assert.equal(entry.isSymbolicLink(), false)
        if (entry.isDirectory()) verify(path.join(dir, entry.name))
      }
    }
    verify(destination)
    const require = createRequire(path.join(destination, 'mcp-file-analyzer.mjs'))
    const sharp = require('sharp')
    assert.ok(require.resolve('sharp').startsWith(destination))
    const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'white' } })
      .png()
      .toBuffer()
    assert.equal((await sharp(image).metadata()).width, 8)
    assert.throws(() => stageRuntime({ destination, bundleFile, projectRoot: root }), {
      code: 'EEXIST',
    })
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true })
  }
})

test('does not create a partial runtime when the compiled bundle is missing', () => {
  const temporary = fs.mkdtempSync(path.join(cache, 'analyzer-missing-'))
  try {
    const destination = path.join(temporary, 'runtime')
    assert.throws(() =>
      stageRuntime({
        destination,
        bundleFile: path.join(temporary, 'missing.mjs'),
        projectRoot: root,
      })
    )
    assert.equal(fs.existsSync(destination), false)
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true })
  }
})
