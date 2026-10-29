import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { renderPreview, extractOcr, extractOfficeText } from '../src/mcp/render'

const command = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => {
  const execFile = Object.assign(vi.fn(), { [Symbol.for('nodejs.util.promisify.custom')]: command })
  return { execFile }
})

const cacheDir = path.resolve('.cache/mcp-analyzer-render-tests')
const file = {
  name: '../../untrusted-name; echo nope.docx',
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  data: Buffer.from('fixture'),
}
let image: Buffer
beforeEach(async () => {
  await mkdir(cacheDir, { recursive: true })
  vi.stubEnv('TMPDIR', cacheDir)
  image = await sharp({ create: { width: 5, height: 5, channels: 3, background: 'white' } })
    .png()
    .toBuffer()
  command.mockReset()
  command.mockImplementation(async (program: string, args: string[]) => {
    if (program === 'soffice') {
      const dir = args[args.indexOf('--outdir') + 1]
      await writeFile(path.join(dir, 'input.pdf'), 'converted-pdf')
    } else if (program === 'pdftoppm') {
      await writeFile(`${args.at(-1)}.png`, image)
    }
    return {
      stdout:
        program === 'tesseract'
          ? 'Recognized text'
          : program === 'pdftotext'
          ? 'Office document text'
          : '',
      stderr: '',
    }
  })
})
afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(cacheDir, { recursive: true, force: true })
})

describe('document rendering command boundaries (simulated native utilities)', () => {
  test('uses fixed filenames, a private Office profile, and bounded PDF rasterization', async () => {
    expect(await renderPreview(file, 2, 1200)).toEqual(image)
    const [program, args, limits] = command.mock.calls[0]
    expect(program).toBe('soffice')
    expect(args.join(' ')).not.toContain('untrusted-name')
    expect(args[0]).toContain('-env:UserInstallation=file:')
    expect(limits).toMatchObject({ timeout: 60_000, maxBuffer: 1024 * 1024 })
    const renderArgs = command.mock.calls[1][1]
    expect(renderArgs.slice(0, 7)).toEqual([
      '-f',
      '2',
      '-l',
      '2',
      '-singlefile',
      '-scale-to',
      '1200',
    ])
    const input = args.at(-1)
    await expect(stat(input)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('cleans temporary input even when conversion fails', async () => {
    let input: string | undefined
    command.mockImplementationOnce(async (_program, args) => {
      input = args.at(-1)
      expect((await readFile(input!)).toString()).toBe('fixture')
      throw new Error('conversion failed')
    })
    await expect(renderPreview(file, 1, 1200)).rejects.toThrow('Document utility failed')
    await expect(stat(input!)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('OCR renders only the explicitly requested pages', async () => {
    const result = await extractOcr({ ...file, mimeType: 'application/pdf' }, 3, 2)
    expect(result).toContain('Page 3')
    expect(result).toContain('Page 4')
    const renders = command.mock.calls.filter(([program]) => program === 'pdftoppm')
    expect(renders.map(([, args]) => args[1])).toEqual(['3', '4'])
    const recognitions = command.mock.calls.filter(([program]) => program === 'tesseract')
    expect(recognitions).toHaveLength(2)
    expect(recognitions[0][1]).toContain('ita+eng')
  })

  test('extracts legacy/ODF Office text through the bounded conversion path', async () => {
    expect(await extractOfficeText(file)).toBe('Office document text')
    expect(command.mock.calls.map(([program]) => program)).toEqual(['soffice', 'pdftotext'])
  })

  test('reports missing native utilities explicitly', async () => {
    command.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }))
    await expect(renderPreview(file, 1, 1200)).rejects.toThrow(
      'Required document utility is not installed: soffice'
    )
  })
})
