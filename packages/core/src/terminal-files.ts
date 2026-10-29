import { constants } from 'fs'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

export const MAX_PREVIEW_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_TEXT_BYTES = 256 * 1024
const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
  '.bmp': 'image/bmp', '.svg': 'image/svg+xml',
}

export type TerminalFileResult =
  | { ok: true; path: string; kind: 'image'; dataUrl: string }
  | { ok: true; path: string; kind: 'text'; text: string; truncated: boolean }
  | { ok: true; path: string; kind: 'binary'; reason: string }
  | { ok: false; error: 'invalid_path' | 'not_found' | 'not_file' | 'unreadable'; message: string }
export type TerminalFileOpenResult = { ok: true } | { ok: false; message: string }

export function resolveTerminalFile(cwd: string, input: string): string {
  if (!input || input.includes('\0') || input.length > 32_768) throw new Error('檔案路徑無效。')
  let target = input
  if (/^file:/i.test(target)) {
    const url = new URL(target)
    if (url.hostname && url.hostname !== 'localhost') throw new Error('只支援本機檔案。')
    target = fileURLToPath(url)
  } else if (/^[a-z][a-z\d+.-]*:/i.test(target) && !/^[a-z]:[\\/]/i.test(target)) {
    throw new Error('只支援本機檔案路徑。')
  }
  if (target.startsWith('~/') || target.startsWith('~\\')) target = path.join(os.homedir(), target.slice(2))
  return path.resolve(cwd, target)
}

/** Inspect an opened descriptor, so special files are never read and reads stay bounded. */
export async function readTerminalFile(cwd: string, input: string, metadataOnly = false): Promise<TerminalFileResult> {
  let target: string
  try {
    target = resolveTerminalFile(cwd, input)
  } catch (error) {
    return { ok: false, error: 'invalid_path', message: error instanceof Error ? error.message : '檔案路徑無效。' }
  }
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined
  try {
    // Check first for platforms that cannot open directories; O_NONBLOCK also
    // protects against a regular path being swapped for a FIFO before open().
    if (!(await fs.stat(target)).isFile()) return { ok: false, error: 'not_file', message: '這個路徑不是一般檔案。' }
    handle = await fs.open(target, constants.O_RDONLY | constants.O_NONBLOCK)
    const stat = await handle.stat()
    if (!stat.isFile()) return { ok: false, error: 'not_file', message: '這個路徑不是一般檔案。' }
    if (metadataOnly) return { ok: true, path: target, kind: 'binary', reason: '' }
    const mime = IMAGE_MIME[path.extname(target).toLowerCase()]
    if (mime && stat.size > MAX_PREVIEW_IMAGE_BYTES) {
      return { ok: true, path: target, kind: 'binary', reason: '圖片超過 20 MB 預覽上限。' }
    }
    const limit = mime ? MAX_PREVIEW_IMAGE_BYTES : MAX_TEXT_BYTES
    const buffer = Buffer.alloc(Math.min(stat.size, limit + 1))
    let bytes = 0
    while (bytes < buffer.length) {
      const { bytesRead } = await handle.read(buffer, bytes, buffer.length - bytes, bytes)
      if (!bytesRead) break
      bytes += bytesRead
    }
    if (mime) {
      if (bytes > limit) return { ok: true, path: target, kind: 'binary', reason: '圖片超過 20 MB 預覽上限。' }
      return { ok: true, path: target, kind: 'image', dataUrl: `data:${mime};base64,${buffer.subarray(0, bytes).toString('base64')}` }
    }
    const sample = buffer.subarray(0, Math.min(bytes, 8192))
    if (/\.(pdf|zip|gz|tar|exe|dll|woff2?|mp4|mov|webm|mp3|wav)$/i.test(target) || sample.some((b) => b === 0 || (b < 9 || (b > 13 && b < 32)))) {
      return { ok: true, path: target, kind: 'binary', reason: '此格式無法在 VibeFlow 內預覽。' }
    }
    return { ok: true, path: target, kind: 'text', text: buffer.subarray(0, Math.min(bytes, limit)).toString('utf8'), truncated: bytes > limit }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return code === 'ENOENT' || code === 'ENOTDIR'
      ? { ok: false, error: 'not_found', message: '找不到這個檔案，可能已被移動或刪除。' }
      : { ok: false, error: 'unreadable', message: '無法讀取這個檔案，請確認存取權限。' }
  } finally {
    await handle?.close()
  }
}
