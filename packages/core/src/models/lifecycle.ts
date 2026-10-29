import type { LlmModel } from '.'

// Provider API shutdowns, not ChatGPT retirements or catalog simplification dates.
// Match the routed model, not the platform ID: several historical IDs are aliases.
const shutdowns: Partial<Record<LlmModel['owned_by'], Record<string, [string, string]>>> = {
  openai: {
    'gpt-3.5-turbo': ['2026-10-23', 'gpt-6.1-terra'],
    'gpt-4': ['2026-10-23', 'gpt-6.1-sol'],
    'gpt-4-turbo': ['2026-10-23', 'gpt-6.1-sol'],
    'gpt-4.1-nano': ['2026-10-23', 'gpt-6-luna'],
    'gpt-5-chat-latest': ['2026-07-23', 'gpt-6.1-sol'],
    'gpt-5.1-chat-latest': ['2026-07-23', 'gpt-6.1-sol'],
    'gpt-5.2-chat-latest': ['2026-08-10', 'gpt-6.1-sol'],
    'gpt-4o-mini': ['2027-01-14', 'gpt-6-luna'],
    'gpt-4.1': ['2027-01-14', 'gpt-6-luna'],
    'gpt-4.1-mini': ['2027-01-14', 'gpt-6-luna'],
    'gpt-5': ['2026-12-11', 'gpt-6.1-sol'],
    'gpt-5-mini': ['2026-12-11', 'gpt-6.1-terra'],
    'gpt-5-nano': ['2026-12-11', 'gpt-6-luna'],
    'gpt-5.1': ['2027-04-01', 'gpt-6.1-sol'],
    'gpt-4o': ['2027-01-14', 'gpt-6-luna'],
    o3: ['2026-12-11', 'gpt-6.1-sol'],
    o1: ['2026-10-23', 'gpt-6.1-sol'],
    'o3-mini': ['2026-10-23', 'gpt-6.1-sol'],
    'o4-mini': ['2026-10-23', 'gpt-6.1-terra'],
  },
  anthropic: {
    'claude-3-haiku-20240307': ['2026-04-20', 'claude-haiku-5-5'],
    'claude-sonnet-4-20250514': ['2026-06-15', 'claude-sonnet-5-5'],
    'claude-opus-4-20250514': ['2026-06-15', 'claude-opus-5-5'],
    'claude-opus-4-1-20250805': ['2026-08-05', 'claude-opus-5-5'],
  },
}

export function modelRetirementMessage(model: LlmModel, now = new Date()): string | undefined {
  if (model.provider === 'mock') return undefined
  const shutdown = shutdowns[model.owned_by]?.[model.model]
  if (!shutdown || now.toISOString().slice(0, 10) < shutdown[0]) return undefined
  return `${model.name} (${model.model}) was retired by its provider on ${shutdown[0]}. Select ${shutdown[1]} explicitly in the assistant settings; the saved model has not been changed.`
}
