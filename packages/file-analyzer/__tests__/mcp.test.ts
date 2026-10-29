import { afterEach, describe, expect, test, vi } from 'vitest'
import sharp from 'sharp'
import * as XLSX from 'xlsx'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { createFileAnalyzerServer } from '../src/mcp/server'
import type { BridgedFile } from '../src/mcp/file-bridge-client'
import { createPdfFixture } from '../test-fixtures/pdf'

const connections: Array<{ close(): Promise<void> }> = []
afterEach(async () => {
  await Promise.all(connections.splice(0).map((c) => c.close()))
})

async function connect(file: BridgedFile) {
  const bridge = { readFile: vi.fn().mockResolvedValue(file) }
  const server = createFileAnalyzerServer(bridge)
  const client = new Client({ name: 'analyzer-test', version: '1' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  connections.push(client, server)
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  const call = async (name: string, args: Record<string, unknown>) =>
    CallToolResultSchema.parse(await client.callTool({ name, arguments: args }))
  return { client, bridge, call }
}

function payload(result: ReturnType<typeof CallToolResultSchema.parse>) {
  const first = result.content[0]
  if (first.type !== 'text') throw new Error('Expected text content')
  return JSON.parse(first.text)
}

describe('local MCP file analyzer', () => {
  test('discovers tools without reading a file', async () => {
    const { client, bridge } = await connect({
      name: 'sample.txt',
      mimeType: 'text/plain',
      data: Buffer.from('hello'),
    })
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toEqual(['analyze_file', 'extract_text', 'render_preview'])
    expect(bridge.readFile).not.toHaveBeenCalled()
  })

  test('analyzes PDF and extracts actual PDF text through MCP', async () => {
    const { buffer, expectedText } = createPdfFixture('direct-name')
    const { call } = await connect({
      name: 'sample.pdf',
      mimeType: 'application/pdf',
      data: buffer,
    })
    const analyzed = payload(await call('analyze_file', { file_id: 'file-1' }))
    expect(analyzed).toMatchObject({ kind: 'pdf', pageCount: 1, hasExtractableText: true })
    expect(analyzed.extractedText).toBeUndefined()
    expect(payload(await call('extract_text', { file_id: 'file-1' })).text).toContain(expectedText)
  })

  test('extracts spreadsheet cells with the existing analyzer', async () => {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ['Name', 'Value'],
        ['alpha', 42],
      ]),
      'Data'
    )
    const data = Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }))
    const { call } = await connect({
      name: 'sample.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      data,
    })
    const result = payload(await call('extract_text', { file_id: 'file-1' }))
    expect(result.text).toContain('alpha,42')
  })

  test('reports truncation explicitly', async () => {
    const { call } = await connect({
      name: 'sample.txt',
      mimeType: 'text/plain',
      data: Buffer.from('a'.repeat(500)),
    })
    const result = payload(await call('extract_text', { file_id: 'file-1', max_chars: 100 }))
    expect(result).toMatchObject({ total_chars: 500, truncated: true })
    expect(result.text).toHaveLength(100)
  })

  test('returns a real, resized PNG with the specific tool response', async () => {
    const data = await sharp({
      create: { width: 300, height: 150, channels: 3, background: '#ff0000' },
    })
      .png()
      .toBuffer()
    const { call } = await connect({ name: 'image.png', mimeType: 'image/png', data })
    const result = await call('render_preview', { file_id: 'file-1', size: 100 })
    const image = result.content.find((part) => part.type === 'image')!
    if (image.type !== 'image') throw new Error('Expected an image')
    const metadata = await sharp(Buffer.from(image.data, 'base64')).metadata()
    expect(metadata).toMatchObject({ width: 100, height: 50, format: 'png' })
  })

  test.each(['../secret', '/etc/passwd', 'https://example.test/file', 'file://secret'])(
    'rejects a path/URL (%s) before accessing the bridge',
    async (id) => {
      const { call, bridge } = await connect({
        name: 'sample.txt',
        mimeType: 'text/plain',
        data: Buffer.from('hello'),
      })
      expect((await call('extract_text', { file_id: id })).isError).toBe(true)
      expect(bridge.readFile).not.toHaveBeenCalled()
    }
  )

  test('does not accept arbitrary path fields', async () => {
    const { call, bridge } = await connect({
      name: 'sample.txt',
      mimeType: 'text/plain',
      data: Buffer.from('hello'),
    })
    expect((await call('extract_text', { file_id: 'file-1', path: '/etc/passwd' })).isError).toBe(
      true
    )
    expect(bridge.readFile).not.toHaveBeenCalled()
  })

  test('returns the parent authorization denial without a fallback read', async () => {
    const { call, bridge } = await connect({
      name: 'sample.txt',
      mimeType: 'text/plain',
      data: Buffer.from('hello'),
    })
    bridge.readFile.mockRejectedValueOnce(new Error('File access denied'))
    const result = await call('extract_text', { file_id: 'denied' })
    expect(result).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'File access denied' }],
    })
    expect(bridge.readFile).toHaveBeenCalledTimes(1)
  })

  test('bounds OCR page count and image dimensions before reading', async () => {
    const { call, bridge } = await connect({
      name: 'sample.txt',
      mimeType: 'text/plain',
      data: Buffer.from('hello'),
    })
    expect(
      (await call('extract_text', { file_id: 'file-1', ocr: true, page_count: 6 })).isError
    ).toBe(true)
    expect((await call('render_preview', { file_id: 'file-1', size: 10_000 })).isError).toBe(true)
    expect(bridge.readFile).not.toHaveBeenCalled()
  })

  test('rejects unknown tools', async () => {
    const { call, bridge } = await connect({
      name: 'sample.txt',
      mimeType: 'text/plain',
      data: Buffer.from('hello'),
    })
    expect((await call('download_url', { url: 'https://example.test' })).isError).toBe(true)
    expect(bridge.readFile).not.toHaveBeenCalled()
  })
})
