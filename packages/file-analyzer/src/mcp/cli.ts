import { Socket } from 'node:net'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { FileBridgeClient, type FileBridge } from './file-bridge-client'
import { createFileAnalyzerServer } from './server'

const args = process.argv.slice(2)
if (args.some((arg) => ['-help', '--help', '-h'].includes(arg))) {
  console.log(`Logicle file analyzer — MCP stdio server
Tools: analyze_file, extract_text, render_preview
Files are read by ID through Logicle's authorized file bridge (FD 3).
PDF/Office previews require Poppler/LibreOffice; OCR requires Tesseract ita+eng.
No download capability or arbitrary filesystem inputs are provided.`)
} else if (args.length) {
  console.error('Unknown arguments. Use --help.')
  process.exitCode = 2
} else {
  let client: FileBridgeClient | undefined
  // Tool discovery uses ordinary MCP stdio without FD 3. Open the bridge lazily
  // only when an actual conversation calls a tool through the sandbox transport.
  const bridge: FileBridge = {
    async readFile(id) {
      if (process.env.LOGICLE_FILE_BRIDGE_FD !== '3') {
        throw new Error(
          'File access requires the Logicle conversation sandbox and file bridge (FD 3)'
        )
      }
      client ??= new FileBridgeClient(new Socket({ fd: 3, readable: true, writable: true }))
      return client.readFile(id)
    },
  }
  const server = createFileAnalyzerServer(bridge)
  process.stdin.once('end', () => {
    client?.close()
    void server.close()
  })
  await server.connect(new StdioServerTransport())
}
