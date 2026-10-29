import { appendFileSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const repository = 'ghcr.io/brucekhetta/logicle'
const digestPattern = /^sha256:[a-f0-9]{64}$/

export function readAnalyzerReference(dockerfile) {
  const matches = [...dockerfile.matchAll(/^ARG[ \t]+FILE_ANALYZER_IMAGE=([^\s]+)[ \t]*$/gm)]
  if (matches.length !== 1)
    throw new Error('Dockerfile must declare one explicit FILE_ANALYZER_IMAGE default')
  const reference = matches[0][1]
  const suffix = reference.slice(repository.length)
  if (
    !reference.startsWith(repository) ||
    !(
      /^:mcp-file-analyzer-\d+\.\d+\.\d+(?:-[a-z0-9]+(?:[.-][a-z0-9]+)*)?$/.test(suffix) ||
      (suffix.startsWith('@') && digestPattern.test(suffix.slice(1)))
    )
  ) {
    throw new Error(
      'FILE_ANALYZER_IMAGE must pin a released analyzer version or digest in the Logicle GHCR package'
    )
  }
  return reference
}

export function pinAnalyzerReference(reference, manifest) {
  if (!digestPattern.test(manifest?.digest ?? ''))
    throw new Error('Registry returned an invalid analyzer manifest digest')
  const configuredDigest = reference.split('@')[1]
  if (configuredDigest && configuredDigest !== manifest.digest)
    throw new Error('Registry digest differs from the configured analyzer digest')
  return `${repository}@${manifest.digest}`
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required')
  const reference = readAnalyzerReference(readFileSync('Dockerfile', 'utf8'))
  let manifest
  try {
    manifest = JSON.parse(
      execFileSync(
        'docker',
        ['buildx', 'imagetools', 'inspect', reference, '--format', '{{json .Manifest}}'],
        {
          encoding: 'utf8',
          maxBuffer: 2 * 1024 * 1024,
        }
      )
    )
  } catch (cause) {
    throw new Error(
      `Cannot read the published analyzer ${reference}. Publish it with the manual file-analyzer workflow first, and check GHCR read access. CI does not build a fallback image.`,
      { cause }
    )
  }
  const image = pinAnalyzerReference(reference, manifest)
  appendFileSync(process.env.GITHUB_OUTPUT, `image=${image}\n`)
  console.log(`Using published analyzer: ${reference} -> ${image}`)
}
