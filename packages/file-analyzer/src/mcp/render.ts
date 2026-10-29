import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'
import type { BridgedFile } from './file-bridge-client'

const execute = promisify(execFile)
const officeExtensions: Record<string, string> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/msword': '.doc',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.oasis.opendocument.text': '.odt',
  'application/vnd.oasis.opendocument.presentation': '.odp',
  'application/vnd.oasis.opendocument.spreadsheet': '.ods',
}

async function run(command: string, args: string[]) {
  try {
    return await execute(command, args, {
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Required document utility is not installed: ${command}`)
    }
    throw new Error(`Document utility failed or timed out: ${command}`)
  }
}

async function withDirectory<T>(task: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'logicle-mcp-analyzer-'))
  try {
    return await task(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function toPdf(file: BridgedFile, dir: string): Promise<string> {
  if (file.mimeType === 'application/pdf') {
    const input = path.join(dir, 'input.pdf')
    await writeFile(input, file.data, { mode: 0o600 })
    return input
  }
  const extension = officeExtensions[file.mimeType]
  if (!extension) throw new Error('Preview supports images, PDF, and Office documents')
  const input = path.join(dir, `input${extension}`)
  await writeFile(input, file.data, { mode: 0o600 })
  await run('soffice', [
    `-env:UserInstallation=${pathToFileURL(path.join(dir, 'profile')).href}`,
    '--headless',
    '--convert-to',
    'pdf',
    '--outdir',
    dir,
    input,
  ])
  const pdf = path.join(dir, 'input.pdf')
  if ((await stat(pdf)).size > 50 * 1024 * 1024)
    throw new Error('Converted PDF exceeds the 50 MiB limit')
  return pdf
}

async function renderPage(pdf: string, dir: string, page: number, size: number): Promise<string> {
  const output = path.join(dir, `page-${page}`)
  await run('pdftoppm', [
    '-f',
    String(page),
    '-l',
    String(page),
    '-singlefile',
    '-scale-to',
    String(size),
    '-png',
    pdf,
    output,
  ])
  const png = `${output}.png`
  if ((await stat(png)).size > 10 * 1024 * 1024) throw new Error('Preview exceeds the 10 MiB limit')
  return png
}

export async function renderPreview(
  file: BridgedFile,
  page: number,
  size: number
): Promise<Buffer> {
  if (file.mimeType.startsWith('image/')) {
    if (page !== 1) throw new Error('Image previews support page 1 only')
    return sharp(file.data, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer()
  }
  return withDirectory(async (dir) => {
    const pdf = await toPdf(file, dir)
    return readFile(await renderPage(pdf, dir, page, size))
  })
}

/** OCR is explicit and bounded: at most five pages per call. */
export async function extractOcr(
  file: BridgedFile,
  firstPage: number,
  pageCount: number
): Promise<string> {
  if (file.mimeType.startsWith('image/') && (firstPage !== 1 || pageCount !== 1)) {
    throw new Error('Image OCR supports page 1 only')
  }
  return withDirectory(async (dir) => {
    const image = file.mimeType.startsWith('image/')
    const pdf = image ? undefined : await toPdf(file, dir)
    if (image)
      await writeFile(path.join(dir, 'image.png'), await renderPreview(file, 1, 1600), {
        mode: 0o600,
      })
    const texts: string[] = []
    for (let page = firstPage; page < firstPage + pageCount; page++) {
      const png = image ? path.join(dir, 'image.png') : await renderPage(pdf!, dir, page, 2000)
      const { stdout } = await run('tesseract', [png, 'stdout', '-l', 'ita+eng', '--psm', '3'])
      texts.push(`--- Page ${page} ---\n${stdout.trim()}`)
    }
    return texts.join('\n\n')
  })
}

export async function extractOfficeText(file: BridgedFile): Promise<string> {
  return withDirectory(async (dir) => {
    const pdf = await toPdf(file, dir)
    const { stdout } = await run('pdftotext', ['-layout', pdf, '-'])
    return stdout
  })
}
