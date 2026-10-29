import { LlmModel } from '.'
import { vertexModels } from './vertex'

const legacyStudioIds = new Set([
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-3.0-pro',
  'gemini-3.1-flash-lite',
  'gemini-3.1-pro',
  'gemini-3.5-flash',
  'gemini-3.6-flash',
  'gemini-3.7-flash',
  'gemini-pro-latest',
  'gemini-flash-latest',
])
const legacyGeminiModels: LlmModel[] = vertexModels
  .filter((model) => legacyStudioIds.has(model.id))
  .map((model) => ({ ...model, provider: 'google-ai-studio' }))

// These models are not offered on the hard-coded us-central1 Vertex backend.
export const gemini4ArgonModel: LlmModel = {
  id: 'gemini-4-argon',
  model: 'gemini-4-argon',
  name: 'Gemini 4 Argon',
  description: 'Advanced reasoning; synchronous generation capped at 64K tokens.',
  provider: 'google-ai-studio',
  owned_by: 'google',
  context_length: 1_048_576,
  maxOutputTokens: 65_536,
  tokenizer: 'approx_4chars',
  capabilities: {
    vision: true,
    function_calling: true,
    supportedMedia: ['application/pdf', 'image/png', 'image/jpeg'],
    temperature: false,
  },
  supportedReasoningEfforts: ['low', 'medium', 'high'],
  defaultReasoning: 'medium',
  tags: ['latest'],
}

export const gemini38FlashModel: LlmModel = {
  ...gemini4ArgonModel,
  id: 'gemini-3.8-flash',
  model: 'gemini-3.8-flash',
  name: 'Gemini 3.8 Flash',
  description: 'Fast general-purpose model with configurable thinking levels.',
}

export const geminiModels: LlmModel[] = [
  gemini4ArgonModel,
  gemini38FlashModel,
  ...legacyGeminiModels.map((model): LlmModel => ({ ...model, tags: ['obsolete'] })),
]
