import { describe, expect, test } from 'vitest'
import fs from 'node:fs'
import YAML from 'yaml'

type Workflow = {
  on: Record<string, unknown>
  permissions?: { packages?: string }
  jobs: Record<string, { uses?: string; permissions?: { packages?: string } }>
}
const publisher = '.github/workflows/file-analyzer.yml'
const readWorkflow = (file: string): Workflow => YAML.parse(fs.readFileSync(file, 'utf8'))

function calledWorkflows(file: string, seen = new Set<string>()): Set<string> {
  if (seen.has(file)) return seen
  seen.add(file)
  for (const job of Object.values(readWorkflow(file).jobs)) {
    if (job.uses?.startsWith('./.github/workflows/')) calledWorkflows(job.uses.slice(2), seen)
  }
  return seen
}

describe('manual analyzer publication policy', () => {
  test('the analyzer publisher accepts only an explicit manual dispatch', () => {
    const workflow = readWorkflow(publisher)
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch'])
  })

  test('ordinary CI and application releases cannot invoke the analyzer publisher', () => {
    for (const entry of ['.github/workflows/ci.yml', '.github/workflows/release.yml']) {
      expect([...calledWorkflows(entry)]).not.toContain(publisher)
    }
  })

  test('ordinary CI has no registry write permission', () => {
    const workflow = readWorkflow('.github/workflows/ci.yml')
    expect(workflow.permissions?.packages).toBe('read')
    for (const job of Object.values(workflow.jobs)) {
      expect(job.permissions?.packages).not.toBe('write')
    }
  })
})
