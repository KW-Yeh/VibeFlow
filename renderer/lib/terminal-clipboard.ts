/**
 * Text a program in the terminal asked to put on the clipboard with OSC 52
 * (`<selection>;<base64>`): tmux's mouse selection and agent TUIs copy this way.
 * A `?` payload asks to *read* the clipboard; the PTY must never get that, so
 * it yields null like any malformed request.
 */
export function osc52Text(data: string): string | null {
  const sep = data.indexOf(';')
  if (sep < 0) return null
  const payload = data.slice(sep + 1)
  if (!payload || payload === '?') return null
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) return null
  try {
    const binary = atob(payload)
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0))
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}
