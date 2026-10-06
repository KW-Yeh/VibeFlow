import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import http from 'node:http'
import WebSocket from 'ws'
import { startWebServer, resolveStatic, TOKEN_COOKIE } from '../packages/core/src/web-server.ts'
import { EventBus } from '../packages/core/src/events.ts'
import { createWsTransport } from '../packages/core/src/ws-transport.ts'
import { createBridge } from '../packages/core/src/client.ts'

const TOKEN = 'test-token-0123456789abcdef'

async function serve(t, handlers = {}) {
  const webDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-web-'))
  await fs.mkdir(path.join(webDir, 'home'), { recursive: true })
  await fs.writeFile(path.join(webDir, 'home', 'index.html'), '<h1>board</h1>')
  await fs.writeFile(path.join(os.tmpdir(), 'vf-outside-secret.txt'), 'secret')
  const bus = new EventBus()
  const server = await startWebServer({
    handlers: { 'vibeflow:getState': () => ({ ok: true }), ...handlers },
    bus,
    token: TOKEN,
    staticDir: webDir,
  })
  t.after(async () => {
    await server.close()
    await fs.rm(webDir, { recursive: true, force: true })
  })
  return { server, bus, port: server.port, webDir }
}

/** Raw request, so Host and Cookie can be anything a hostile page could send. */
function request(port, pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: pathname, headers: { Host: `127.0.0.1:${port}`, ...headers } },
      (res) => {
        let body = ''
        res.on('data', (d) => (body += d))
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }))
      }
    )
    req.on('error', reject)
    req.end()
  })
}

/** Resolves with the HTTP status of a refused upgrade, or 101 when it opens. */
function tryUpgrade(port, headers) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers })
    ws.on('open', () => {
      ws.close()
      resolve(101)
    })
    ws.on('unexpected-response', (_req, res) => resolve(res.statusCode))
    ws.on('error', () => {})
  })
}

const cookie = `${TOKEN_COOKIE}=${TOKEN}`

test('it listens on loopback only', async (t) => {
  const { server } = await serve(t)
  assert.match(server.loginUrl(), /^http:\/\/127\.0\.0\.1:\d+\/home\/\?token=/)
  const addresses = os.networkInterfaces()
  const external = Object.values(addresses)
    .flat()
    .find((a) => a && !a.internal && a.family === 'IPv4')
  if (external) {
    await assert.rejects(
      new Promise((resolve, reject) => {
        const req = http.get({ host: external.address, port: server.port, path: '/', timeout: 1500 }, resolve)
        req.on('error', reject)
        req.on('timeout', () => req.destroy(new Error('timeout')))
      })
    )
  }
})

test('pages need the token; the token turns into an HttpOnly SameSite=Strict cookie', async (t) => {
  const { port } = await serve(t)
  assert.equal((await request(port, '/home/')).status, 401)
  assert.equal((await request(port, '/home/?token=wrong')).status, 401)

  const login = await request(port, `/home/?token=${TOKEN}&x=1`)
  assert.equal(login.status, 302)
  // The token leaves the address bar; other query params stay.
  assert.equal(login.headers.location, '/home/?x=1')
  const setCookie = login.headers['set-cookie'][0]
  assert.match(setCookie, /HttpOnly/)
  assert.match(setCookie, /SameSite=Strict/)

  const page = await request(port, '/home/', { Cookie: cookie })
  assert.equal(page.status, 200)
  assert.equal(page.body, '<h1>board</h1>')
  assert.equal(page.headers['x-frame-options'], 'DENY')
})

test('a foreign Host header is refused (DNS rebinding)', async (t) => {
  const { port } = await serve(t)
  assert.equal((await request(port, '/home/', { Host: `attacker.example:${port}`, Cookie: cookie })).status, 403)
  assert.equal((await request(port, '/home/', { Host: `localhost:${port}`, Cookie: cookie })).status, 200)
})

test('the WebSocket needs our Origin and the cookie, or a bearer token without Origin', async (t) => {
  const { port } = await serve(t)
  const origin = `http://127.0.0.1:${port}`
  assert.equal(await tryUpgrade(port, {}), 401, 'no credentials')
  assert.equal(await tryUpgrade(port, { Origin: 'https://evil.example', Cookie: cookie }), 403, 'cross-site page')
  assert.equal(await tryUpgrade(port, { Origin: origin }), 401, 'our origin, no cookie')
  assert.equal(await tryUpgrade(port, { Origin: origin, Authorization: `Bearer ${TOKEN}` }), 401, 'a page cannot use the bearer path')
  assert.equal(await tryUpgrade(port, { Authorization: 'Bearer wrong' }), 401)
  assert.equal(await tryUpgrade(port, { Host: `evil.example:${port}`, Authorization: `Bearer ${TOKEN}` }), 403)
  assert.equal(await tryUpgrade(port, { Origin: origin, Cookie: cookie }), 101)
  assert.equal(await tryUpgrade(port, { Authorization: `Bearer ${TOKEN}` }), 101)
})

test('only the handler table is callable, and events are pushed', async (t) => {
  const { port, bus } = await serve(t, {
    'echo:twice': (a, b) => [a, b],
    'boom:fail': () => {
      throw Object.assign(new Error('nope'), { code: 'INVALID_REQUEST' })
    },
  })
  const transport = createWsTransport({
    connect: () => new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Authorization: `Bearer ${TOKEN}` } }),
  })
  t.after(() => transport.close())
  assert.deepEqual(await transport.invoke('echo:twice', 1, 'x'), [1, 'x'])
  await assert.rejects(transport.invoke('constructor'), /unknown method/)
  await assert.rejects(transport.invoke('__proto__'), /unknown method/)
  await assert.rejects(transport.invoke('boom:fail'), { message: 'nope', code: 'INVALID_REQUEST' })

  const bridge = createBridge(transport)
  assert.equal(bridge.transport, 'ws')
  assert.deepEqual(await bridge.getState(), { ok: true })
  const got = new Promise((resolve) => bridge.term.onData(resolve))
  bus.emit('pty:data', { sessionKey: 'k', data: 'hello' })
  assert.deepEqual(await got, { sessionKey: 'k', data: 'hello' })
})

test('static paths cannot escape the web root', async (t) => {
  const { port, webDir } = await serve(t)
  assert.equal(resolveStatic(webDir, '/../vf-outside-secret.txt'), null)
  assert.equal(resolveStatic(webDir, '/%2e%2e/vf-outside-secret.txt'), null)
  assert.equal(resolveStatic(webDir, '/home'), path.join(webDir, 'home', 'index.html'))
  assert.equal((await request(port, '/..%2fvf-outside-secret.txt', { Cookie: cookie })).status, 404)
})

test('a taken port falls back to a free one only when asked', async (t) => {
  const blocker = http.createServer()
  await new Promise((r) => blocker.listen(0, '127.0.0.1', r))
  t.after(() => new Promise((r) => blocker.close(r)))
  const taken = blocker.address().port
  const base = { handlers: {}, bus: new EventBus(), token: TOKEN, staticDir: null, port: taken }

  await assert.rejects(startWebServer(base), { code: 'EADDRINUSE' })

  const server = await startWebServer({ ...base, fallbackToFreePort: true })
  t.after(() => server.close())
  assert.notEqual(server.port, taken)
  const res = await request(server.port, '/')
  assert.equal(typeof res.status, 'number')
})
