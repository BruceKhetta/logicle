# Fork CI and manual image publication

This fork publishes container images to `ghcr.io/brucekhetta/logicle`.
The workflows do not create Git tags or GitHub Releases, or publish charts,
Docker Hub images, or coverage to GitHub Pages.

## Tests

`Basic CI` runs on every push, can be started manually, and is reused by the
image publication workflow. It checks provider mocks, TypeScript types,
the frontend bundle budget, unit coverage, and Docker smoke/integration
tests using SQLite and PostgreSQL.
Coverage is available as the `coverage` workflow artifact.

The separate manual live-provider workflow requires the fork's own provider
credentials; ordinary CI uses mocked providers.

## Publish an image

Open **Actions → Publish fork image (manual) → Run workflow**. Select the
branch containing the changes to publish and supply the single input `tag`,
for example `1.0.1`.

The supplied value is used unchanged for the image tag and `APP_VERSION`:

- Container image: `ghcr.io/brucekhetta/logicle:1.0.1`.
- Application version: `1.0.1`.

There is no upstream lookup, ancestry check, SemVer validation, automatic
prefix or suffix, or check for an existing tag. Docker and the registry
apply their normal image-tag constraints. Publishing the same tag again
updates it to the newly built image.

The workflow runs the complete CI before building and publishing the image.
All jobs use the selected commit, even if the branch moves during the run.
Publication jobs only run in `BruceKhetta/logicle`. GHCR paths are normalized
to lowercase. Publication uses the fork's `GITHUB_TOKEN` with `packages: write`
and `contents: read`; no Docker Hub credentials are needed.

## Promote an image to latest

To promote a published image, manually run
**Promote fork image to latest (manual)** with `version: 1.0.1`.
This updates the fork's GHCR `latest` tag. Publishing an image does not
otherwise update `latest` unless `latest` itself is supplied as the image tag.

## Upstream dependencies

The Dockerfile still reads the pinned public file-analyzer image
`ghcr.io/logicleai/mcp-file-analyzer:0.11.0`. This is a build dependency, not a
publication destination. Internal workspace package names also retain their
existing scope. Neither causes a write or publication to the upstream project.
The analyzer image can be replaced with a separately maintained mirror using
the existing Docker build argument `FILE_ANALYZER_IMAGE` once that mirror exists.
