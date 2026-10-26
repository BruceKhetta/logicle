import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const baseVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/
const suffixPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/

export function resolveReleaseVersion(upstreamTag, nhTag, repository) {
  if (typeof upstreamTag !== 'string' || typeof nhTag !== 'string' || upstreamTag !== upstreamTag.trim() || nhTag !== nhTag.trim()) {
    throw new Error('Both upstream_tag and nh_tag are required.')
  }
  const baseVersion = upstreamTag.replace(/^v/, '')
  const match = baseVersionPattern.exec(baseVersion)
  if (!match || baseVersion.includes('-nh-') || match[4]?.split('.').some((part) => /^0\d+$/.test(part))) {
    throw new Error('upstream_tag must be an upstream version such as v0.36.0 or v0.36.0-b1.')
  }
  if (!suffixPattern.test(nhTag)) {
    throw new Error('nh_tag must contain lowercase letters or numbers separated by dots or hyphens.')
  }
  const version = `${baseVersion}-nh-${nhTag}`
  const prerelease = version.slice(version.indexOf('-') + 1)
  if (prerelease.split('.').some((part) => /^0\d+$/.test(part))) {
    throw new Error('Numeric prerelease identifiers must not have leading zeroes.')
  }
  if (version.length > 128) {
    throw new Error('The resulting image tag must not exceed 128 characters.')
  }
  if (typeof repository !== 'string' || repository !== repository.trim() || !/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error('Expected a GitHub owner/repository name.')
  }
  return {
    version,
    release_tag: `v${version}`,
    image: `ghcr.io/${repository.toLowerCase()}`,
  }
}

function main() {
  const { UPSTREAM_TAG, NH_TAG, GITHUB_REPOSITORY, GITHUB_SHA, GITHUB_OUTPUT } = process.env
  const result = resolveReleaseVersion(UPSTREAM_TAG, NH_TAG, GITHUB_REPOSITORY)
  if (!GITHUB_SHA || !GITHUB_OUTPUT) {
    throw new Error('Run this entrypoint in GitHub Actions with GITHUB_SHA and GITHUB_OUTPUT.')
  }

  // Use the exact supplied tag and the selected commit, never the newest tag
  // in the repository or the current tip of a branch that may have moved.
  const baseCommit = execFileSync('git', ['rev-parse', '--verify', `refs/tags/${UPSTREAM_TAG}^{commit}`], {
    encoding: 'utf8',
  }).trim()
  execFileSync('git', ['merge-base', '--is-ancestor', baseCommit, GITHUB_SHA])

  const existingTag = spawnSync('git', ['show-ref', '--verify', '--quiet', `refs/tags/${result.release_tag}`])
  if (existingTag.status === 0) {
    throw new Error(`Tag ${result.release_tag} already exists; choose a new nh_tag.`)
  }
  if (existingTag.error || existingTag.status !== 1) {
    throw new Error('Could not check whether the fork release tag exists.', { cause: existingTag.error })
  }

  for (const [key, value] of Object.entries(result)) {
    appendFileSync(GITHUB_OUTPUT, `${key}=${value}\n`)
  }
  console.log(`Release ${result.release_tag}: ${result.image}:${result.version}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
