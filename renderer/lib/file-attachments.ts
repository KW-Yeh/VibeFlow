import type { AttachmentInput } from '@/lib/types'

function readAttachment(file: File): Promise<AttachmentInput> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error(`無法讀取附件：${file.name}`))
        return
      }
      const separatorIndex = reader.result.indexOf(',')
      if (separatorIndex < 0) {
        reject(new Error(`無法解析附件：${file.name}`))
        return
      }
      resolve({
        name: file.name,
        mime: file.type || 'application/octet-stream',
        dataBase64: reader.result.slice(separatorIndex + 1),
      })
    }
    reader.onerror = () => reject(reader.error ?? new Error(`無法讀取附件：${file.name}`))
    reader.readAsDataURL(file)
  })
}

export function filesToAttachmentInputs(
  files: FileList | File[]
): Promise<AttachmentInput[]> {
  return Promise.all(Array.from(files).map(readAttachment))
}
