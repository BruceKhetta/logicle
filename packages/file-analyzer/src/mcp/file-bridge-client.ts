import type { Duplex } from 'node:stream'

export interface BridgedFile {
  name: string
  mimeType: string
  data: Buffer
}

export interface FileBridge {
  readFile(id: string): Promise<BridgedFile>
}

const MAX_FILE_BYTES = 50 * 1024 * 1024
const MAX_HEADER_BYTES = 16 * 1024

type Reply = {
  type: string
  requestId?: string
  name?: string
  mimeType?: string
  size?: number
  message?: string
}

/** Client of Logicle's private FD 3 protocol. The parent owns file authorization. */
export class FileBridgeClient implements FileBridge {
  private buffer = Buffer.alloc(0)
  private header?: Reply
  private pending?: {
    id: string
    resolve: (reply: BridgedFile) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  }
  private queue: Promise<unknown> = Promise.resolve()
  private nextId = 0
  private failure?: Error

  constructor(
    private channel: Duplex,
    private timeoutMs = 30_000
  ) {
    channel.on('data', (data: Buffer) => {
      try {
        this.receive(Buffer.from(data))
      } catch (error) {
        this.fail(error as Error)
      }
    })
    channel.on('error', (error) => this.fail(error))
    channel.on('end', () => this.fail(new Error('File bridge closed')))
    channel.on('close', () => this.fail(new Error('File bridge closed')))
  }

  readFile(id: string): Promise<BridgedFile> {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) return Promise.reject(new Error('Invalid file ID'))
    return this.enqueue(() => this.request({ type: 'read-file', id }))
  }

  close() {
    this.fail(new Error('File bridge closed'))
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task)
    this.queue = result.catch(() => {})
    return result
  }

  private request(payload: Record<string, unknown>): Promise<BridgedFile> {
    if (this.failure) return Promise.reject(this.failure)
    const id = String(++this.nextId)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => this.fail(new Error('File bridge request timed out')),
        this.timeoutMs
      )
      this.pending = { id, resolve, reject, timer }
      const header = Buffer.from(JSON.stringify({ ...payload, requestId: id }) + '\n')
      this.channel.write(header, (error) => {
        if (error) this.fail(error)
      })
    })
  }

  private fail(error: Error) {
    this.failure ??= error
    if (this.pending) {
      clearTimeout(this.pending.timer)
      this.pending.reject(this.failure)
      this.pending = undefined
    }
    this.buffer = Buffer.alloc(0)
    this.header = undefined
    this.channel.destroy()
  }

  private complete(value?: BridgedFile, error?: Error) {
    const pending = this.pending!
    clearTimeout(pending.timer)
    this.pending = undefined
    if (error) pending.reject(error)
    else pending.resolve(value!)
  }

  private receive(chunk: Buffer) {
    if (this.failure) return
    this.buffer = Buffer.concat([this.buffer, chunk])
    while (this.buffer.length || this.header) {
      if (!this.pending) throw new Error('Unexpected file bridge response')
      if (this.header) {
        const header = this.header
        if (this.buffer.length < header.size!) return
        const data = Buffer.from(this.buffer.subarray(0, header.size!))
        this.buffer = this.buffer.subarray(header.size!)
        this.header = undefined
        this.complete({ name: header.name!, mimeType: header.mimeType!, data })
        continue
      }
      const newline = this.buffer.indexOf(10)
      if (newline < 0) {
        if (this.buffer.length > MAX_HEADER_BYTES) throw new Error('File bridge header too large')
        return
      }
      if (newline > MAX_HEADER_BYTES) throw new Error('File bridge header too large')
      const header: Reply = JSON.parse(this.buffer.subarray(0, newline).toString('utf8'))
      this.buffer = this.buffer.subarray(newline + 1)
      if (!header || header.requestId !== this.pending.id)
        throw new Error('Invalid file bridge response ID')
      if (header.type === 'error') {
        this.complete(undefined, new Error(header.message ?? 'File bridge rejected the request'))
      } else if (header.type === 'file') {
        if (
          typeof header.name !== 'string' ||
          typeof header.mimeType !== 'string' ||
          !Number.isSafeInteger(header.size) ||
          header.size! < 0 ||
          header.size! > MAX_FILE_BYTES
        ) {
          throw new Error('Invalid file metadata or file exceeds the 50 MiB limit')
        }
        this.header = header
      } else {
        throw new Error('Unexpected file bridge response type')
      }
    }
  }
}
