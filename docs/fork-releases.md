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

## MCP file analyzer: manual, versioned releases

**Build and publish MCP file analyzer** runs only through `workflow_dispatch`.
It builds the local sources with `packages/file-analyzer/Dockerfile` for
`linux/amd64` and `linux/arm64` and publishes to the same
`ghcr.io/brucekhetta/logicle` package as the application. No separate repository
or package is created.

A manual release publishes only `mcp-file-analyzer-<version>`, for example
`mcp-file-analyzer-1.0.0`. It does not publish commit tags, application tags, or
`latest`. Neither ordinary pushes nor application releases invoke this workflow.
There is no automatic fallback build when the required image is unavailable.
Existing registry images are not deleted by this change.

### Ordinary CI and application releases

Push CI still checks analyzer source as part of the normal unit tests. It does
not repeat the analyzer's dedicated multi-platform build and packaging tests or
push analyzer images. Its registry permissions are read-only.

Before building the application, the Docker job reads `FILE_ANALYZER_IMAGE` from
the checked-out app Dockerfile, resolves that released version to its registry
manifest digest, and passes the digest into the app build and smoke tests. The
reusable CI exports this reference as `file_analyzer_image`; the application
release uses that same digest. The release validation caller needs only
`packages: read`; the final application publication job retains its own write
permission for publishing the application.

If the configured version is missing or unreadable, CI fails with instructions
to publish it manually and check GHCR access. It never publishes on behalf of
a normal CI run. Workflow policy tests guard against reintroducing an automatic
call to the analyzer publisher.

### Publishing or upgrading the analyzer

1. Make the manual workflow available on the default branch.
2. Open **Actions → Build and publish MCP file analyzer → Run workflow**.
3. Select the source branch and set the component version, initially `1.0.0`.
4. After publication succeeds, set the app Dockerfile's `FILE_ANALYZER_IMAGE`
   default to the released version (or its digest). The initial default already
   selects `ghcr.io/brucekhetta/logicle:mcp-file-analyzer-1.0.0`.
5. Run ordinary app CI/release using that published dependency.

For changes to the analyzer, choose a new component version, publish it manually,
and explicitly update the Dockerfile pin when the app should adopt it. A source
change alone does not upgrade the MCP runtime imported into the application.
A manual rerun of an existing version may reassign its tag; use a new version
for changed contents. CI and app release builds preserve the exact digest they
resolved and tested in that execution.

The manual workflow validates tags, runtime packaging, TypeScript and focused
analyzer tests before building. Native image checks run for each target platform
before publication. Only `BruceKhetta/logicle` may publish; authentication uses
the existing `GITHUB_TOKEN`. Component publication creates no Git tag or GitHub
Release and does not deploy anything. GHCR read access or public package
visibility is needed for pulls from other machines.

The main Dockerfile retains its original analyzer stage/import structure and
imports the launcher plus its separate Node runtime folder. The backend's
internal file-analysis worker is unchanged.

See [file analyzer source and tool contract](../packages/file-analyzer/README.md)
for supported formats and the [dedicated Dockerfile](../packages/file-analyzer/Dockerfile).
