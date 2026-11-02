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

export function resolveUpstreamBase(upstreamRepository, upstreamTag, sha, runGit = execFileSync) {
  if (typeof upstreamRepository !== 'string' || !/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(upstreamRepository)) {
    throw new Error('UPSTREAM_REPOSITORY must be a GitHub owner/repository name.')
  }
  // Validate before placing the supplied tag in a fetch refspec.
  resolveReleaseVersion(upstreamTag, '1', upstreamRepository)
  const upstreamRef = 'refs/release-validation/upstream-base'
  const upstreamUrl = `https://github.com/${upstreamRepository}.git`
  try {
    runGit('git', ['fetch', '--no-tags', upstreamUrl, `+refs/tags/${upstreamTag}:${upstreamRef}`], {
      stdio: 'inherit',
    })
  } catch (cause) {
    throw new Error(`Could not fetch upstream tag ${upstreamTag} from ${upstreamRepository}.`, { cause })
  }
  const baseCommit = runGit('git', ['rev-parse', '--verify', `${upstreamRef}^{commit}`], {
    encoding: 'utf8',
  }).trim()
  try {
    runGit('git', ['merge-base', '--is-ancestor', baseCommit, sha])
  } catch (cause) {
    throw new Error(`Upstream tag ${upstreamTag} is not an ancestor of selected commit ${sha}, or ancestry could not be checked.`, { cause })
  }
  return baseCommit
}

function main() {
  const { UPSTREAM_TAG, UPSTREAM_REPOSITORY, NH_TAG, GITHUB_REPOSITORY, GITHUB_SHA, GITHUB_OUTPUT } = process.env
  const result = resolveReleaseVersion(UPSTREAM_TAG, NH_TAG, GITHUB_REPOSITORY)
  if (!GITHUB_SHA || !GITHUB_OUTPUT) {
    throw new Error('Run this entrypoint in GitHub Actions with GITHUB_SHA and GITHUB_OUTPUT.')
  }

  // Fetch only the exact base tag from upstream without overwriting fork tags.
  resolveUpstreamBase(UPSTREAM_REPOSITORY, UPSTREAM_TAG, GITHUB_SHA)

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
