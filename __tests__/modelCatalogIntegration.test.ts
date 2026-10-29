import { afterEach, describe, expect, test, vi } from 'vitest'
import type { LanguageModelV3CallOptions, LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { createLanguageModelBasic } from '@/backend/lib/chat/provider-factory'
import { stockModels } from '@/lib/chat/models'
import type { ProviderConfig } from '@/types/provider'

vi.mock('@/lib/env', () => ({ default: { dumpLlmConversation: false } }))
vi.mock('@/lib/logging', () => ({ loggingFetch: undefined }))

afterEach(() => vi.unstubAllGlobals())

const models = stockModels.filter(
  (m) =>
    m.id === m.model &&
    m.tags?.includes('latest') &&
    !m.tags.includes('obsolete') &&
    m.provider !== 'logiclecloud' &&
    m.owned_by !== 'perplexity'
)

const tool = {
  type: 'function' as const,
  name: 'lookup',
  inputSchema: { type: 'object' as const, properties: {} },
}
const usage = { input_tokens: 10, output_tokens: 2 }
const call = {
  type: 'function_call',
  id: 'fc_1',
  call_id: 'call_1',
  name: 'lookup',
  arguments: '{}',
  status: 'completed',
}

function options(owner: string): LanguageModelV3CallOptions {
  return {
    prompt: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe the image and document.' },
          { type: 'file', mediaType: 'image/png', data: new Uint8Array([1, 2, 3]) },
          {
            type: 'file',
            mediaType: 'application/pdf',
            data: new Uint8Array([4, 5, 6]),
            filename: 'document.pdf',
          },
        ],
      },
    ],
    tools: [tool],
    toolChoice: { type: 'auto' },
    maxOutputTokens: 64,
    providerOptions:
      owner === 'openai'
        ? { openai: { forceReasoning: true, store: false, reasoningEffort: 'medium' } }
        : owner === 'anthropic'
        ? { anthropic: { thinking: { type: 'adaptive', display: 'summarized' }, effort: 'medium' } }
        : { google: { thinkingConfig: { thinkingLevel: 'medium', includeThoughts: true } } },
  }
}

function response(owner: string) {
  if (owner === 'openai')
    return {
      id: 'resp_1',
      model: 'test',
      output: [
        {
          type: 'message',
          id: 'msg_1',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'ok', annotations: [] }],
        },
        call,
      ],
      usage,
    }
  if (owner === 'anthropic')
    return {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'test',
      content: [
        { type: 'text', text: 'ok' },
        { type: 'tool_use', id: 'call_1', name: 'lookup', input: {} },
      ],
      stop_reason: 'tool_use',
      usage,
    }
  return {
    candidates: [
      {
        content: {
          role: 'model',
          parts: [{ text: 'ok' }, { functionCall: { name: 'lookup', args: {} } }],
        },
        finishReason: 'STOP',
      },
    ],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2 },
  }
}

function events(owner: string): unknown[] {
  if (owner === 'openai')
    return [
      { type: 'response.created', response: { id: 'resp_1', created_at: 0, model: 'test' } },
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: { type: 'message', id: 'msg_1' },
      },
      { type: 'response.output_text.delta', item_id: 'msg_1', delta: 'ok' },
      { type: 'response.output_item.added', output_index: 1, item: { ...call, arguments: '' } },
      { type: 'response.output_item.done', output_index: 1, item: call },
      { type: 'response.completed', response: { usage } },
    ]
  if (owner === 'anthropic')
    return [
      {
        type: 'message_start',
        message: { id: 'msg_1', model: 'test', usage: { input_tokens: 10, output_tokens: 0 } },
      },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_use', id: 'call_1', name: 'lookup', input: {} },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '{}' },
      },
      { type: 'content_block_stop', index: 1 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 2 } },
      { type: 'message_stop' },
    ]
  return [response(owner)]
}

describe('catalog models with the installed provider SDKs (mock HTTP, no provider calls)', () => {
  test.each(models)(
    '$provider/$id generates text and tool calls with image/PDF inputs',
    async (model) => {
      const fetch = vi.fn(
        async () =>
          new Response(JSON.stringify(response(model.owned_by)), {
            headers: { 'content-type': 'application/json' },
          })
      )
      vi.stubGlobal('fetch', fetch)
      const languageModel = createLanguageModelBasic(
        { providerType: model.provider, apiKey: 'test', provisioned: false } as ProviderConfig,
        model
      )
      const result = await languageModel.doGenerate(options(model.owned_by))
      expect(result.content).toContainEqual(expect.objectContaining({ type: 'text', text: 'ok' }))
      expect(result.content).toContainEqual(
        expect.objectContaining({ type: 'tool-call', toolName: 'lookup' })
      )
      const [url, request] = fetch.mock.calls[0] as unknown as [string, RequestInit]
      const body = JSON.parse(request.body as string)
      if (model.owned_by === 'google')
        expect(url).toContain(`/models/${model.model}:generateContent`)
      else expect(body.model).toBe(model.model)
      expect(JSON.stringify(body)).toContain('AQID')
      expect(JSON.stringify(body)).toContain('BAUG')
      if (model.owned_by === 'openai') {
        expect(url).toContain('/responses')
        expect(body.reasoning.effort).toBe('medium')
        expect(body.include).toContain('reasoning.encrypted_content')
        expect(body.tools[0].name).toBe('lookup')
      } else if (model.owned_by === 'anthropic') {
        expect(body.thinking).toEqual({ type: 'adaptive', display: 'summarized' })
        expect(body.output_config.effort).toBe('medium')
      } else {
        expect(body.generationConfig.thinkingConfig).toEqual({
          thinkingLevel: 'medium',
          includeThoughts: true,
        })
        expect(body.generationConfig.thinkingConfig.thinkingBudget).toBeUndefined()
      }
    }
  )

  test.each(models)('$provider/$id streams text and tool calls', async (model) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            events(model.owned_by)
              .map((event) => `data: ${JSON.stringify(event)}\n\n`)
              .join(''),
            { headers: { 'content-type': 'text/event-stream' } }
          )
      )
    )
    const languageModel = createLanguageModelBasic(
      { providerType: model.provider, apiKey: 'test', provisioned: false } as ProviderConfig,
      model
    )
    const result = await languageModel.doStream(options(model.owned_by))
    const parts: LanguageModelV3StreamPart[] = []
    for await (const part of result.stream) parts.push(part)
    expect(parts.filter((p) => p.type === 'error')).toEqual([])
    expect(parts).toContainEqual(expect.objectContaining({ type: 'text-delta', delta: 'ok' }))
    expect(parts).toContainEqual(expect.objectContaining({ type: 'tool-call', toolName: 'lookup' }))
    expect(parts).toContainEqual(expect.objectContaining({ type: 'finish' }))
  })

  test('rejects a confirmed retired model before making an HTTP request', () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const model = stockModels.find((m) => m.provider === 'anthropic' && m.id === 'claude-3-haiku')!
    expect(() =>
      createLanguageModelBasic(
        { providerType: 'anthropic', apiKey: 'test' } as ProviderConfig,
        model
      )
    ).toThrow('Select claude-haiku-5-5 explicitly')
    expect(fetch).not.toHaveBeenCalled()
  })
})
