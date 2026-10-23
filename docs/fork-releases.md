# Fork CI and manual releases

This fork publishes container images to `ghcr.io/brucekhetta/logicle` and
GitHub Releases to `BruceKhetta/logicle`. It does not publish charts, Docker
Hub images, or coverage to GitHub Pages. Existing chart sources are retained
for future use; no chart package is published by the workflows.

## Tests

`Basic CI` runs on pushes, can be started manually, and is reused by the
release workflow. It checks release-version validation, provider mocks, TypeScript types, the frontend bundle budget, unit
coverage, and Docker smoke/integration tests using SQLite and PostgreSQL.
Coverage is available as the `coverage` workflow artifact.

The separate manual live-provider workflow requires the fork's own provider
credentials; ordinary CI and release validation use mocked providers.

## Publish a version

After these workflow changes are available on the fork's default branch,
open **Actions → Publish fork release (manual) → Run workflow**. Select the
branch containing the changes to publish and supply:

| Input | Example | Meaning |
| --- | --- | --- |
| `upstream_tag` | `v0.36.0` | Exact existing upstream base tag included in the selected commit's history. |
| `nh_tag` | `1` | Manual fork suffix; lowercase letters and numbers, with dots or hyphens as separators. |

This example produces:

- Image and application version: `0.36.0-nh-1`.
- Container image: `ghcr.io/brucekhetta/logicle:0.36.0-nh-1`.
- Git tag and GitHub Release: `v0.36.0-nh-1`.

The workflow validates inputs, verifies that the upstream tag is an ancestor
of the selected commit, and refuses an existing fork release tag. It runs
the complete CI before building and publishing the image. The GitHub Release
then records the selected commit, upstream base and published image digest.
All jobs use the same selected commit, even if the branch moves during the run.

The workflow only runs publication jobs in `BruceKhetta/logicle`. GHCR paths
are normalized to lowercase. Publication uses the fork's `GITHUB_TOKEN` with
`packages: write` and `contents: write`; no Docker Hub credentials are needed.
GitHub Actions and package/release writes must be permitted by the repository
and account policies. Newly published package visibility must be configured
on GitHub if anonymous pulls are required.

`0.36.0-nh-1` has SemVer prerelease syntax. Neither the container's `latest`
tag nor GitHub's latest-release designation is updated automatically. To
promote a tested image, manually run **Promote fork image to latest (manual)**
with `version: 0.36.0-nh-1` (without the `v` prefix). This updates only the
fork's GHCR `latest` tag.

Image publication and GitHub Release creation are separate operations. If
the image push succeeds but release creation fails, the image can already
exist; inspect the failed step before retrying. Choose a new suffix for a
new release instead of overwriting an existing release tag.

## Upstream dependencies

The Dockerfile still reads the pinned public file-analyzer image
`ghcr.io/logicleai/mcp-file-analyzer:0.11.0`. This is a build dependency, not a
publication destination. Internal workspace package names also retain their
existing scope. Neither causes a write or publication to the upstream project.
The analyzer image can be replaced with a separately maintained mirror using
the existing Docker build argument `FILE_ANALYZER_IMAGE` once that mirror exists.
