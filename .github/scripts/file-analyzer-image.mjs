import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export function resolveFileAnalyzerImage(repository, sha, version) {
  if (repository?.toLowerCase() !== 'brucekhetta/logicle')
    throw new Error('Analyzer publication is restricted to BruceKhetta/logicle')
  if (!/^[a-f0-9]{40}$/.test(sha ?? '')) throw new Error('Expected a full Git commit SHA')
  if (
    typeof version !== 'string' ||
    !version ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[a-z0-9]+(?:[.-][a-z0-9]+)*)?$/.test(version)
  ) {
    throw new Error('Expected an analyzer version such as 1.0.0 or 1.0.0-rc.1')
  }
  const image = `ghcr.io/${repository.toLowerCase()}`
  const versionTag = `mcp-file-analyzer-${version}`
  if (versionTag.length > 128) throw new Error('Analyzer tag exceeds the Docker tag length limit')
  return {
    image,
    version_tag: `${image}:${versionTag}`,
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = resolveFileAnalyzerImage(
    process.env.GITHUB_REPOSITORY,
    process.env.GITHUB_SHA,
    process.env.ANALYZER_VERSION ?? ''
  )
  if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required')
  for (const [key, value] of Object.entries(result))
    appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`)
}
