import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { analyzeFileBuffer } from '../analyzers'
import type { FileBridge } from './file-bridge-client'
import { extractOcr, extractOfficeText, renderPreview } from './render'

const fileId = z.string().regex(/^[A-Za-z0-9_-]+$/, 'Expected a Logicle file ID, not a path or URL')
const analyzeInput = z.object({ file_id: fileId }).strict()
const extractInput = analyzeInput
  .extend({
    max_chars: z.number().int().min(100).max(200_000).default(20_000),
    ocr: z.boolean().default(false),
    first_page: z.number().int().min(1).max(1000).default(1),
    page_count: z.number().int().min(1).max(5).default(1),
  })
  .strict()
const previewInput = analyzeInput
  .extend({
    page: z.number().int().min(1).max(1000).default(1),
    size: z.number().int().min(100).max(1600).default(1200),
  })
  .strict()

const text = (value: unknown): CallToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(value) }],
})

export function createFileAnalyzerServer(bridge: FileBridge) {
  const server = new Server(
    { name: 'logicle-file-analyzer', version: '1.0.0' },
    { capabilities: { tools: {} } }
  )
  let queue: Promise<unknown> = Promise.resolve()
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'analyze_file',
        description:
          'Inspect an attached file: type, size, pages, image dimensions, or document metadata. Supply its Logicle file ID; paths and URLs are not supported.',
        inputSchema: z.toJSONSchema(analyzeInput, { target: 'draft-7' }),
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      {
        name: 'extract_text',
        description:
          'Extract text from an attached PDF, Word, PowerPoint, spreadsheet, or text file. Set ocr=true for scanned PDFs or images (Italian/English, at most 5 pages per call). max_chars bounds the result; omitted text is reported explicitly.',
        inputSchema: z.toJSONSchema(extractInput, { target: 'draft-7' }),
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      {
        name: 'render_preview',
        description:
          'Return one page as a PNG preview from an attached image, PDF, or Office document. Logicle saves the returned image as a chat artifact. Supply a file ID and optional 1-based page and image size.',
        inputSchema: z.toJSONSchema(previewInput, { target: 'draft-7' }),
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
    ],
  }))

  async function call(name: string, args: unknown): Promise<CallToolResult> {
    try {
      if (name === 'analyze_file') {
        const input = analyzeInput.parse(args)
        const file = await bridge.readFile(input.file_id)
        const { extractedText: _, ...analysis } = await analyzeFileBuffer(file.data, file.mimeType)
        return text({ file_id: input.file_id, name: file.name, ...analysis })
      }
      if (name === 'extract_text') {
        const input = extractInput.parse(args)
        const file = await bridge.readFile(input.file_id)
        let extracted: string
        if (input.ocr) {
          extracted = await extractOcr(file, input.first_page, input.page_count)
        } else {
          const analysis = await analyzeFileBuffer(file.data, file.mimeType)
          extracted = analysis.extractedText ?? ''
          if (analysis.kind === 'unknown') {
            if (
              analysis.isText &&
              (file.mimeType.startsWith('text/') ||
                ['application/json', 'application/xml'].includes(file.mimeType))
            )
              extracted = file.data.toString('utf8')
            else if (
              file.mimeType.includes('opendocument') ||
              ['application/msword', 'application/vnd.ms-powerpoint'].includes(file.mimeType)
            ) {
              extracted = await extractOfficeText(file)
            } else throw new Error('Unsupported text format; use PDF, Office, or a text file')
          }
        }
        return text({
          file_id: input.file_id,
          name: file.name,
          text: extracted.slice(0, input.max_chars),
          total_chars: extracted.length,
          truncated: extracted.length > input.max_chars,
          ...(input.ocr ? { first_page: input.first_page, page_count: input.page_count } : {}),
          ...(!extracted.trim()
            ? {
                notice:
                  'No extractable text found. For scanned PDFs or images, retry with ocr=true.',
              }
            : {}),
        })
      }
      if (name === 'render_preview') {
        const input = previewInput.parse(args)
        const file = await bridge.readFile(input.file_id)
        const png = await renderPreview(file, input.page, input.size)
        if (png.length > 10 * 1024 * 1024) throw new Error('Preview exceeds the 10 MiB limit')
        // Return the image with this specific MCP response. Logicle's normalizer
        // persists it, avoiding shared artifact queues between parallel calls.
        return {
          content: [
            { type: 'text', text: `Preview of ${file.name}, page ${input.page}` },
            { type: 'image', mimeType: 'image/png', data: png.toString('base64') },
          ],
        }
      }
      throw new Error(`Unknown tool: ${name}`)
    } catch (error) {
      return {
        isError: true,
        content: [
          { type: 'text', text: error instanceof Error ? error.message : 'File analysis failed' },
        ],
      }
    }
  }

  server.setRequestHandler(CallToolRequestSchema, (request) => {
    const result = queue.then(() => call(request.params.name, request.params.arguments ?? {}))
    queue = result.catch(() => {})
    return result
  })
  return server
}
