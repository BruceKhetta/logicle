import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const inside = (root, file) => {
  const relative = path.relative(root, file)
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  )
}

function resolvePackage(name, from, root) {
  if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name))
    throw new Error(`Invalid package name: ${name}`)
  const require = createRequire(path.join(from, 'package.json'))
  // Read manifests through filesystem paths: native @img packages deliberately
  // do not export package.json. Never fall back to host/global installations.
  for (const modules of require.resolve.paths(name) ?? []) {
    const manifest = path.join(modules, name, 'package.json')
    if (!inside(root, manifest) || !fs.existsSync(manifest)) continue
    const directory = fs.realpathSync(path.dirname(manifest))
    if (inside(root, directory)) return directory
  }
  return undefined
}

function supports(values, current) {
  return (
    !values ||
    (!values.includes(`!${current}`) &&
      (values.every((v) => v.startsWith('!')) || values.includes(current)))
  )
}

/** Stage the existing locked Sharp runtime graph, with native packages as
 * siblings so their relative shared-library paths keep working after COPY. */
export function stageRuntime({ destination, bundleFile, projectRoot = process.cwd() }) {
  const sourceRoot = fs.realpathSync(path.join(projectRoot, 'node_modules'))
  const rootPackage = resolvePackage('sharp', projectRoot, sourceRoot)
  if (!rootPackage) throw new Error('Install the locked dependencies before staging Sharp')
  fs.accessSync(bundleFile)
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.mkdirSync(destination) // Refuse to overwrite an existing runtime tree.
  fs.copyFileSync(bundleFile, path.join(destination, 'mcp-file-analyzer.mjs'))
  const packages = new Map()
  const libc =
    process.platform === 'linux'
      ? process.report.getReport().header.glibcVersionRuntime
        ? 'glibc'
        : 'musl'
      : undefined

  function copy(name, source, optional = false) {
    if (!source) {
      if (optional) return
      throw new Error(`Missing required runtime dependency: ${name}`)
    }
    const pkg = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'))
    if (
      optional &&
      (!supports(pkg.os, process.platform) ||
        !supports(pkg.cpu, process.arch) ||
        !supports(pkg.libc, libc))
    )
      return
    if (packages.has(name)) {
      if (packages.get(name) !== source) throw new Error(`Conflicting runtime versions for ${name}`)
      return
    }
    packages.set(name, source)
    const target = path.join(destination, 'node_modules', name)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.cpSync(source, target, {
      recursive: true,
      dereference: true,
      filter: (file) => path.relative(source, file).split(path.sep)[0] !== 'node_modules',
    })
    const optionalNames = new Set(Object.keys(pkg.optionalDependencies ?? {}))
    const names = new Set([...Object.keys(pkg.dependencies ?? {}), ...optionalNames])
    for (const dependency of [...names].sort()) {
      copy(
        dependency,
        resolvePackage(dependency, source, sourceRoot),
        optionalNames.has(dependency)
      )
    }
  }
  copy('sharp', rootPackage)
  return [...packages.keys()].sort()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) throw new Error('Usage: stage-runtime.mjs DESTINATION')
  const packages = stageRuntime({
    destination: path.resolve(process.argv[2]),
    bundleFile: path.resolve('dist-file-analyzer/mcp-file-analyzer.mjs'),
  })
  console.log(`Staged analyzer runtime: ${packages.join(', ')}`)
}
