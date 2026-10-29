import { defineConfig } from 'tsup'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'))

export default defineConfig({
  entry: { 'mcp-file-analyzer': 'packages/file-analyzer/src/mcp/cli.ts' },
  tsconfig: 'packages/file-analyzer/tsconfig.json',
  outDir: 'dist-file-analyzer',
  outExtension: () => ({ js: '.mjs' }),
  target: 'node24',
  format: ['esm'],
  platform: 'node',
  splitting: false,
  clean: true,
  dts: false,
  external: ['sharp'],
  noExternal: Object.keys(pkg.dependencies).filter((name) => name !== 'sharp'),
  esbuildOptions(options) {
    options.banner = {
      js: "import { createRequire as __createRequire } from 'node:module'; var require = __createRequire(import.meta.url);",
    }
  },
})
