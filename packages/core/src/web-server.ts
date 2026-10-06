import fs from 'fs'
import http from 'http'
import path from 'path'
import type { Duplex } from 'stream'
import { timingSafeEqual } from 'crypto'
import { WebSocketServer, type WebSocket } from 'ws'
import type { EventBus } from './events'
import type { CoreHandlers } from './service'

/**
 * core over HTTP + WebSocket, for the browser and remote TUIs.
 *
 * This socket can start agents, type into terminals and push branches, so it
 * is guarded as a remote-execution endpoint:
 *  1. It binds loopback only (127.0.0.1, plus ::1 when available).
 *  2. A per-run token is required. The browser brings it once as `?token=` and
 *     swaps it for an HttpOnly, SameSite=Strict cookie; the token then leaves
 *     the address bar.
 *  3. The WebSocket handshake needs that cookie (or `Authorization: Bearer` from
 *     a non-browser client) and an `Origin` of this very server. Any other page
 *     the browser has open cannot connect (cross-site WebSocket hijacking).
 *  4. `Host` must name this server on loopback, which defeats DNS rebinding.
 *  5. The lock file that hands the token to the TUI is 0600 (lock.ts).
 */
export interface WebServerOptions {
  handlers: CoreHandlers
  bus: EventBus
  token: string
  /** The renderer's static export. Null serves the API only. */
  staticDir: string | null
  /** 0 = pick a free port. */
  port?: number
  /** When `port` is taken, pick a free one instead of failing. */
  fallbackToFreePort?: boolean
}

export interface WebServer {
  port: number
  /** `http://127.0.0.1:<port><pathname>?token=…`, the address the browser opens first. */
  loginUrl(pathname?: string): string
  close(): Promise<void>
}

export const TOKEN_COOKIE = 'vf_token'
const WS_PATH = '/ws'
/** Attachments travel base64 in one message. */
const MAX_PAYLOAD = 256 * 1024 * 1024

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
}

function sameToken(given: string | undefined | null, token: string): boolean {
  if (!given) return false
  const a = Buffer.from(given)
  const b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

function bearer(header: string | undefined): string | null {
  const m = /^Bearer\s+(.+)$/i.exec(header ?? '')
  return m ? m[1].trim() : null
}

/** Resolve a URL path inside `root`; null when it escapes or does not exist. */
export function resolveStatic(root: string, urlPath: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null
  const rel = path.posix.normalize(decoded).replace(/^\/+/, '')
  const base = path.resolve(root)
  const candidates = [rel, path.posix.join(rel, 'index.html'), `${rel}.html`]
  for (const c of candidates) {
    const full = path.resolve(base, c)
    if (full !== base && !full.startsWith(base + path.sep)) return null
    try {
      if (fs.statSync(full).isFile()) return full
    } catch {
      // try the next form
    }
  }
  return null
}

export async function startWebServer(options: WebServerOptions): Promise<WebServer> {
  const { handlers, bus, token, staticDir } = options
  let port = options.port ?? 0

  const allowedHosts = () => new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`])
  const allowedOrigins = () => new Set(Array.from(allowedHosts(), (h) => `http://${h}`))

  function send(res: http.ServerResponse, status: number, body: string, headers: http.OutgoingHttpHeaders = {}) {
    res.writeHead(status, {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
      ...headers,
    })
    res.end(body)
  }

  function handleHttp(req: http.IncomingMessage, res: http.ServerResponse) {
    if (!allowedHosts().has(req.headers.host ?? '')) {
      send(res, 403, 'Forbidden host')
      return
    }
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
    const queryToken = url.searchParams.get('token')
    if (queryToken !== null) {
      if (!sameToken(queryToken, token)) {
        send(res, 401, 'Invalid token')
        return
      }
      url.searchParams.delete('token')
      send(res, 302, '', {
        'Set-Cookie': `${TOKEN_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/`,
        Location: `${url.pathname}${url.search}`,
        'Referrer-Policy': 'no-referrer',
      })
      return
    }
    if (!sameToken(parseCookies(req.headers.cookie)[TOKEN_COOKIE], token)) {
      send(res, 401, 'VibeFlow: open this page with the `vibeflow` command, which adds a one-time token.')
      return
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      send(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' })
      return
    }
    if (!staticDir) {
      send(res, 404, 'No web UI in this build')
      return
    }
    if (url.pathname === '/') {
      send(res, 302, '', { Location: '/home/' })
      return
    }
    const file = resolveStatic(staticDir, url.pathname)
    if (!file) {
      send(res, 404, 'Not found')
      return
    }
    const ext = path.extname(file).toLowerCase()
    const immutable = url.pathname.startsWith('/_next/static/')
    res.writeHead(200, {
      'Content-Type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-store',
    })
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    fs.createReadStream(file).pipe(res)
  }

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD })

  function reject(socket: Duplex, status: number, reason: string) {
    socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
    socket.destroy()
  }

  /** Why an upgrade is refused, or null when it may proceed. Exported logic, tested directly. */
  function upgradeRefusal(req: http.IncomingMessage): string | null {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
    if (url.pathname !== WS_PATH) return 'Not found'
    if (!allowedHosts().has(req.headers.host ?? '')) return 'Forbidden host'
    const origin = req.headers.origin
    if (origin !== undefined) {
      // A browser always sends Origin; only our own page may connect.
      if (!allowedOrigins().has(origin)) return 'Forbidden origin'
      if (!sameToken(parseCookies(req.headers.cookie)[TOKEN_COOKIE], token)) return 'Unauthorized'
      return null
    }
    // Non-browser clients (TUI, CLI) carry the token from the lock file.
    if (!sameToken(bearer(req.headers.authorization), token)) return 'Unauthorized'
    return null
  }

  function handleUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer) {
    const refusal = upgradeRefusal(req)
    if (refusal) {
      reject(socket, refusal === 'Not found' ? 404 : refusal === 'Unauthorized' ? 401 : 403, refusal)
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => serveClient(ws))
  }

  function serveClient(ws: WebSocket) {
    const offBus = bus.on((event, payload) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ event, payload }))
    })
    ws.on('close', offBus)
    ws.on('message', async (raw) => {
      let msg: { id?: unknown; method?: unknown; params?: unknown }
      try {
        msg = JSON.parse(String(raw))
      } catch {
        return
      }
      const id = typeof msg.id === 'number' || typeof msg.id === 'string' ? msg.id : undefined
      const reply = (body: Record<string, unknown>) => {
        if (id !== undefined && ws.readyState === ws.OPEN) ws.send(JSON.stringify({ id, ...body }))
      }
      const method = typeof msg.method === 'string' ? msg.method : ''
      // Only the handler table is reachable: no prototype keys, no dynamic dispatch.
      if (!Object.prototype.hasOwnProperty.call(handlers, method)) {
        reply({ error: { message: `unknown method ${method}`, code: 'INVALID_REQUEST' } })
        return
      }
      const params = Array.isArray(msg.params) ? msg.params : []
      try {
        const result = await handlers[method](...params)
        reply({ result: result === undefined ? null : result })
      } catch (err) {
        const e = err as Error & { code?: string }
        reply({ error: { message: e?.message ?? String(err), code: e?.code } })
      }
    })
  }

  const servers: http.Server[] = []
  function listen(host: string, wanted: number): Promise<http.Server> {
    return new Promise((resolve, reject) => {
      const server = http.createServer(handleHttp)
      server.on('upgrade', handleUpgrade)
      server.once('error', reject)
      server.listen(wanted, host, () => {
        server.off('error', reject)
        resolve(server)
      })
    })
  }

  let v4: http.Server
  try {
    v4 = await listen('127.0.0.1', port)
  } catch (err) {
    if (!options.fallbackToFreePort || port === 0 || (err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err
    v4 = await listen('127.0.0.1', 0)
  }
  servers.push(v4)
  port = (v4.address() as { port: number }).port
  try {
    servers.push(await listen('::1', port))
  } catch {
    // No IPv6 loopback on this machine; 127.0.0.1 alone is enough.
  }

  return {
    port,
    loginUrl: (pathname = '/home/') => `http://127.0.0.1:${port}${pathname}?token=${encodeURIComponent(token)}`,
    close: async () => {
      for (const client of wss.clients) client.terminate()
      await Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r()))))
    },
  }
}
