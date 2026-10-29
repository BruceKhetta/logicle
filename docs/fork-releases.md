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

| Input          | Example   | Meaning                                                                                |
| -------------- | --------- | -------------------------------------------------------------------------------------- |
| `upstream_tag` | `v0.36.0` | Exact existing upstream base tag included in the selected commit's history.            |
| `nh_tag`       | `1`       | Manual fork suffix; lowercase letters and numbers, with dots or hyphens as separators. |

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

## MCP file analyzer in the same GHCR package

**Build and publish MCP file analyzer** is a reusable workflow in this repository,
also available through `workflow_dispatch`. It builds the local sources with
`packages/file-analyzer/Dockerfile` for `linux/amd64` and `linux/arm64`, validates
the analyzer/runtime, and publishes to **the same** `ghcr.io/brucekhetta/logicle`
package as the application. No separate GitHub repository or GHCR package is
created. Its tags are isolated from the application's tags:

- Every CI run publishes `mcp-file-analyzer-sha-<full commit SHA>`.
- A manual run additionally publishes `mcp-file-analyzer-<version>`.
- The analyzer workflow does not assign application release tags or `latest`.

The Basic CI publication job waits for release-input validation, provider mocks,
type checking, frontend checks, and unit tests. The analyzer workflow also runs
its own focused source/packaging tests so a standalone manual invocation remains
validated. Native image checks run during each platform's Docker build, before
the multi-platform manifest is pushed. The app's Docker smoke job then receives
that image's digest as `FILE_ANALYZER_IMAGE`.

The reusable CI exposes `file_analyzer_image`; the application release workflow
passes this same digest into its final build. Permissions for that caller include
`packages: write` because CI now publishes the component before the app build.
Only `BruceKhetta/logicle` may publish; authentication uses the existing
`GITHUB_TOKEN`, with no additional credentials.

### First publication and local builds

Once the workflow is available on the default branch, open **Actions → Build and
publish MCP file analyzer → Run workflow**, select the desired source branch,
and set `version: 1.0.0`. This creates the default image expected by the app:

`ghcr.io/brucekhetta/logicle:mcp-file-analyzer-1.0.0`

Until that run succeeds, the default tag does not exist. CI and release builds
bootstrap independently by first publishing the commit image, then consuming its
digest. For local builds before a version tag exists, override
`FILE_ANALYZER_IMAGE` with a published commit tag/digest, or build the component
locally using its Dockerfile and use that local image as the build argument.
GHCR read access or public package visibility is required for pulls from other
machines. Package visibility/access remains an account/repository setting.

Choose a new component version for changed contents. A manual rerun with the
same version may reassign that version tag; the CI/app release pipeline always
uses digests to identify the exact artifact tested in that run. A failed later
app smoke test can leave a commit-tagged analyzer image published, but blocks the
application release. Component publication alone creates no Git tag or GitHub
Release and does not deploy anything.

The main Dockerfile retains its original analyzer stage/import structure. The
only additions are the fork image reference and the separate Node runtime
folder imported alongside the launcher. The backend build no longer compiles
the MCP executable; the internal file-analysis worker is unchanged.

See [file analyzer source and tool contract](../packages/file-analyzer/README.md)
for supported formats and the [dedicated Dockerfile](../packages/file-analyzer/Dockerfile).
