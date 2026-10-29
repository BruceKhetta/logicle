import { describe, expect, test } from 'vitest'
import { stockModels } from '@/lib/chat/models'
import { llmModelSchema } from '@/types/dto/llmmodel'
import { modelRetirementMessage } from '@/lib/chat/models/lifecycle'
import previousRoutes from './fixtures/model-routes-before-issue-3.json'

const recommended = stockModels.filter(
  (m) => m.tags?.includes('latest') && !m.tags.includes('obsolete')
)

describe('October 2026 model catalog', () => {
  test('preserves every previous provider, saved ID, and routed model', () => {
    for (const previous of previousRoutes) {
      expect(
        stockModels.find((m) => m.provider === previous.provider && m.id === previous.id)
      ).toMatchObject(previous)
    }
  })

  test('has no duplicate IDs within a provider', () => {
    const keys = stockModels.map((m) => `${m.provider}:${m.id}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  test('offers the eight validated models directly and through Logicle Cloud', () => {
    const ids = [
      'gpt-6.1-sol',
      'gpt-6.1-terra',
      'gpt-6-luna',
      'claude-opus-5-5',
      'claude-sonnet-5-5',
      'claude-haiku-5-5',
      'gemini-4-argon',
      'gemini-3.8-flash',
    ]
    for (const id of ids) {
      expect(recommended.filter((m) => m.id === id)).toHaveLength(2)
    }
  })

  test('does not advertise unverified Perplexity presets or unsupported Vertex regions', () => {
    expect(stockModels.some((m) => m.id.startsWith('perplexity/preset/'))).toBe(false)
    expect(
      stockModels.some(
        (m) => m.provider === 'gcp-vertex' && ['gemini-4-argon', 'gemini-3.8-flash'].includes(m.id)
      )
    ).toBe(false)
  })

  test('serializes capabilities and limits without losing temperature or PDF limits', () => {
    for (const model of recommended.filter((m) => m.owned_by !== 'perplexity')) {
      const parsed = llmModelSchema.parse(model)
      expect(parsed.capabilities).toEqual(model.capabilities)
      expect(parsed.maxOutputTokens).toBeGreaterThan(0)
      expect(parsed.supportedReasoningEfforts).toContain(parsed.defaultReasoning)
    }
  })

  test('keeps obsolete routing aliases visible under their actual model names', () => {
    for (const model of stockModels.filter((m) => m.id === 'gemini-3.0-pro')) {
      expect(model.name).toContain('3.1 Pro Preview')
      expect(model.model).toBe('gemini-3.1-pro-preview')
    }
    const alias = stockModels.find((m) => m.provider === 'gcp-vertex' && m.id === 'gemini-1.5-pro')!
    expect(alias.name).toContain('2.5 Pro')
    expect(alias.context_length).toBe(1_000_000)
  })

  test('distinguishes future deprecation from retirement and never substitutes models', () => {
    const model = stockModels.find((m) => m.provider === 'openai' && m.id === 'gpt-4.1')!
    expect(modelRetirementMessage(model, new Date('2026-10-28T00:00:00Z'))).toBeUndefined()
    expect(modelRetirementMessage(model, new Date('2027-01-14T00:00:00Z'))).toContain(
      'Select gpt-6-luna explicitly'
    )
    expect(model.model).toBe('gpt-4.1')
    const alias = stockModels.find((m) => m.provider === 'gcp-vertex' && m.id === 'gemini-1.5-pro')!
    expect(modelRetirementMessage(alias, new Date('2026-10-28T00:00:00Z'))).toBeUndefined()
  })
})
