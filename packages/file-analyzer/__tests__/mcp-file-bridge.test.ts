import { afterEach, describe, expect, test } from 'vitest'
import { Duplex, PassThrough } from 'node:stream'
import { FileBridgeClient } from '../src/mcp/file-bridge-client'

const clients: FileBridgeClient[] = []
afterEach(() => {
  clients.splice(0).forEach((c) => c.close())
})

function setup(timeoutMs = 1000) {
  const requests = new PassThrough()
  const replies = new PassThrough()
  const channel = Duplex.from({ writable: requests, readable: replies })
  const client = new FileBridgeClient(channel, timeoutMs)
  clients.push(client)
  let buffer = ''
  let handle: (request: Record<string, string>) => void = () => {}
  requests.on('data', (chunk) => {
    buffer += chunk.toString()
    let newline: number
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      handle(JSON.parse(line))
    }
  })
  return {
    client,
    replies,
    onRequest: (fn: typeof handle) => {
      handle = fn
    },
  }
}

describe('Logicle file bridge client framing', () => {
  test('reads fragmented binary bytes without treating embedded newlines as JSON', async () => {
    const { client, replies, onRequest } = setup()
    const bytes = Buffer.from([0, 10, 255, 3])
    onRequest(({ requestId }) => {
      const header =
        JSON.stringify({
          type: 'file',
          requestId,
          name: 'test.bin',
          mimeType: 'application/octet-stream',
          size: bytes.length,
        }) + '\n'
      replies.write(header.slice(0, 10))
      replies.write(header.slice(10))
      replies.write(bytes.subarray(0, 2))
      replies.write(bytes.subarray(2))
    })
    expect((await client.readFile('file-1')).data).toEqual(bytes)
  })

  test('serializes concurrent reads and handles empty files', async () => {
    const { client, replies, onRequest } = setup()
    const ids: string[] = []
    onRequest(({ id, requestId }) => {
      ids.push(id)
      replies.write(
        JSON.stringify({ type: 'file', requestId, name: id, mimeType: 'text/plain', size: 0 }) +
          '\n'
      )
    })
    const files = await Promise.all([client.readFile('first'), client.readFile('second')])
    expect(ids).toEqual(['first', 'second'])
    expect(files.map((f) => f.data.length)).toEqual([0, 0])
  })

  test('an authorization error leaves framing intact for the next request', async () => {
    const { client, replies, onRequest } = setup()
    onRequest(({ id, requestId }) => {
      replies.write(
        JSON.stringify(
          id === 'denied'
            ? { type: 'error', requestId, message: 'File access denied' }
            : { type: 'file', requestId, name: id, mimeType: 'text/plain', size: 0 }
        ) + '\n'
      )
    })
    await expect(client.readFile('denied')).rejects.toThrow('File access denied')
    expect((await client.readFile('allowed')).name).toBe('allowed')
  })

  test('rejects oversized replies and closes the connection', async () => {
    const { client, replies, onRequest } = setup()
    onRequest(({ requestId }) =>
      replies.write(
        JSON.stringify({
          type: 'file',
          requestId,
          name: 'huge',
          mimeType: 'text/plain',
          size: 51 * 1024 * 1024,
        }) + '\n'
      )
    )
    await expect(client.readFile('huge')).rejects.toThrow('50 MiB')
    await expect(client.readFile('next')).rejects.toThrow('50 MiB')
  })

  test('rejects mismatched reply IDs', async () => {
    const { client, replies, onRequest } = setup()
    onRequest(() =>
      replies.write(JSON.stringify({ type: 'error', requestId: 'wrong', message: 'no' }) + '\n')
    )
    await expect(client.readFile('file-1')).rejects.toThrow('response ID')
  })

  test('rejects malformed and overlong headers', async () => {
    for (const header of ['not json\n', 'x'.repeat(17 * 1024)]) {
      const { client, replies, onRequest } = setup()
      onRequest(() => replies.write(header))
      await expect(client.readFile('file-1')).rejects.toThrow()
    }
  })

  test('times out a truncated payload instead of hanging', async () => {
    const { client, replies, onRequest } = setup(20)
    onRequest(({ requestId }) =>
      replies.write(
        JSON.stringify({
          type: 'file',
          requestId,
          name: 'truncated',
          mimeType: 'text/plain',
          size: 100,
        }) + '\nshort'
      )
    )
    await expect(client.readFile('file-1')).rejects.toThrow('timed out')
  })

  test('rejects path traversal before writing a request', async () => {
    const { client, onRequest } = setup()
    let requests = 0
    onRequest(() => {
      requests++
    })
    await expect(client.readFile('../secret')).rejects.toThrow('Invalid file ID')
    expect(requests).toBe(0)
  })
})
