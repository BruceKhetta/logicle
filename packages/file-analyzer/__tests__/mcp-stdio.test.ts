import { afterEach, describe, expect, test, vi } from 'vitest'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { SandboxedStdioClientTransport } from '@/backend/lib/tools/mcp/sandboxed-stdio-transport'
import { McpFileBridge } from '@/backend/lib/tools/mcp/file-bridge'

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), getFile: vi.fn(), read: vi.fn() }))
vi.mock('@/backend/lib/files/authorization', () => ({ canAccessFile: mocks.authorize }))
vi.mock('@/models/file', () => ({ getFileWithId: mocks.getFile }))
vi.mock('@/lib/storage', () => ({ storage: { readBuffer: mocks.read } }))

const clients: Client[] = []
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()))
})
const script = path.resolve('packages/file-analyzer/src/mcp/cli.ts')

function client() {
  const result = new Client({ name: 'stdio-analyzer-test', version: '1' })
  clients.push(result)
  return result
}

describe('MCP analyzer process and Logicle transport', () => {
  test('discovers tools on ordinary stdio without FD 3 and rejects file access', async () => {
    const connection = client()
    await connection.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ['--import', 'tsx', script],
        env: { PATH: process.env.PATH ?? '', LOGICLE_FILE_BRIDGE_FD: '' },
        cwd: process.cwd(),
        stderr: 'pipe',
      })
    )
    expect((await connection.listTools()).tools.map((t) => t.name)).toContain('render_preview')
    const result = CallToolResultSchema.parse(
      await connection.callTool({ name: 'analyze_file', arguments: { file_id: 'file-1' } })
    )
    expect(result).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: expect.stringContaining('conversation sandbox') }],
    })
  })

  test('reads authorized bytes through actual FD 3 and respects the parent authorization decision', async () => {
    mocks.authorize.mockImplementation(async (_scope, id) => id === 'allowed')
    mocks.getFile.mockResolvedValue({
      id: 'allowed',
      name: 'example.txt',
      type: 'text/plain',
      path: 'storage-key',
      encryption: null,
    })
    mocks.read.mockResolvedValue(Buffer.from('Authorized attachment text'))
    const connection = client()
    await connection.connect(
      new SandboxedStdioClientTransport({
        command: process.execPath,
        args: ['--import', 'tsx', script],
        cwd: process.cwd(),
        onFileBridge: (channel) => {
          new McpFileBridge(channel, { conversationId: 'chat-1', userId: 'user-1' })
        },
      })
    )
    const result = CallToolResultSchema.parse(
      await connection.callTool({ name: 'extract_text', arguments: { file_id: 'allowed' } })
    )
    expect(result.isError).not.toBe(true)
    const content = result.content[0]
    if (content.type !== 'text') throw new Error('Expected extracted text')
    expect(JSON.parse(content.text).text).toBe('Authorized attachment text')
    expect(mocks.authorize).toHaveBeenCalledWith({ userId: 'user-1' }, 'allowed')

    const denied = CallToolResultSchema.parse(
      await connection.callTool({ name: 'extract_text', arguments: { file_id: 'denied' } })
    )
    expect(denied).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'File access denied' }],
    })
    expect(mocks.read).toHaveBeenCalledTimes(1)
  })
})
