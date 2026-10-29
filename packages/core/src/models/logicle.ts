import { LlmModel } from '.'
import { openaiModels } from './openai'
import { anthropicModels } from './anthropic'
import { vertexModels } from './vertex'
import { gemini4ArgonModel, gemini38FlashModel } from './gemini'
import { perplexityModels } from './perplexity'

export const logicleModels: LlmModel[] = [
  ...openaiModels,
  ...anthropicModels,
  gemini4ArgonModel,
  gemini38FlashModel,
  ...vertexModels,
  ...perplexityModels,
].map((model) => ({ ...model, provider: 'logiclecloud' }))
