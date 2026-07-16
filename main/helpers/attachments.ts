import { randomUUID } from 'crypto'
import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import type { ChatAttachment } from './chat-store'
import { execEnv } from './env'

export interface AttachmentInput {
  name: string
  mime: string
  dataBase64: string
}

export const ATTACHMENTS_DIR = '.vibeflow-attachments'

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const MAX_FILENAME_BYTES = 200

function truncateUtf8(value: string, maxBytes: number): string {
  let result = ''
  for (const character of value) {
    if (Buffer.byteLength(result + character) > maxBytes) break
    result += character
  }
  return result
}

function safeAttachmentName(name: string): string {
  const basename = name.replace(/\\/g, '/').split('/').pop() ?? ''
  const sanitized = truncateUtf8(
    basename.replace(/[\u0000-\u001f\u007f]/g, '').trim(),
    MAX_FILENAME_BYTES
  )
  return sanitized && sanitized !== '.' && sanitized !== '..' ? sanitized : 'attachment'
}

function decodeAttachment(input: AttachmentInput): Buffer {
  if (input.dataBase64.length % 4 !== 0 || !BASE64_PATTERN.test(input.dataBase64)) {
    throw new Error(`附件格式無效：${safeAttachmentName(input.name)}`)
  }
  return Buffer.from(input.dataBase64, 'base64')
}

function ensureAttachmentExclude(worktreePath: string): void {
  try {
    const excludePath = execFileSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-path', 'info/exclude'],
      { cwd: worktreePath, encoding: 'utf8', env: execEnv() }
    ).trim()
    const entry = `${ATTACHMENTS_DIR}/`
    const content = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, 'utf8') : ''
    if (!content.split(/\r?\n/).includes(entry)) {
      fs.mkdirSync(path.dirname(excludePath), { recursive: true })
      fs.appendFileSync(excludePath, `\n# VibeFlow task attachments (runtime-only)\n${entry}\n`)
    }
  } catch {
    // Non-git callers can still use attachment storage without ignore management.
  }
}

export function writeAttachments(
  worktreePath: string,
  inputs: AttachmentInput[]
): ChatAttachment[] {
  if (inputs.length === 0) return []

  const decodedInputs = inputs.map((input) => ({
    input,
    name: safeAttachmentName(input.name),
    bytes: decodeAttachment(input),
  }))
  ensureAttachmentExclude(worktreePath)
  const attachmentDir = path.join(worktreePath, ATTACHMENTS_DIR)
  fs.mkdirSync(attachmentDir, { recursive: true })

  return decodedInputs.map(({ input, name, bytes }) => {
    const id = randomUUID().slice(0, 8)
    const filePath = path.join(attachmentDir, `${id}-${name}`)
    fs.writeFileSync(filePath, bytes)
    return { id, name, mime: input.mime, path: filePath }
  })
}
