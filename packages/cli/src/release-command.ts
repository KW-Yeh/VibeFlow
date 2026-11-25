import { parseArgs } from 'node:util'
import { liveHost } from '../../core/src/lock'
import { createNodePlatform, setPlatform } from '../../core/src/platform'
import { getStoreAtPath, normalizeBoard, resolveAutonomousSettings } from '../../core/src/store'
import { occupiedSlots, readyCards } from '../../core/src/release'
import { connectToHost } from './remote'
import { CliFailure, fail, resolveStorePath } from './task-command'

export const RELEASE_USAGE = `
VibeFlow release switch

Usage:
  vibeflow release on [options]       Open a batch and start 準備開工 cards from the 盤點
                                      column, in column order, up to the concurrency limit
  vibeflow release off [options]      Stop releasing; running cards carry on. The batch
                                      closes and its report is written
  vibeflow release status [options]   Whether it is on, the open batch, slots and ready cards

  on / off need the running VibeFlow host; status reads the store.

Options:
  --store-path <dir>     Store directory (defaults to VIBEFLOW_STORE_DIR in a task shell)
  --profile <name>       dev | prod
  -h, --help             Show this help
`.trim()

export async function runReleaseCommand(argv: string[]): Promise<number> {
  try {
    const result = await releaseCommand(argv)
    if (result === null) {
      console.log(RELEASE_USAGE)
      return 0
    }
    process.stdout.write(JSON.stringify({ ok: true, ...result }, null, 2) + '\n')
    return 0
  } catch (err) {
    const e = err as { code?: string; message?: string }
    process.stdout.write(JSON.stringify({ ok: false, error: { code: e.code ?? 'UNKNOWN_ERROR', message: e.message ?? String(err) } }) + '\n')
    return 1
  }
}

async function releaseCommand(argv: string[]): Promise<Record<string, unknown> | null> {
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        'store-path': { type: 'string' },
        profile: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: true,
      strict: true,
    })
  } catch (err) {
    fail('INVALID_ARGUMENT', (err as Error).message)
  }
  const { values, positionals } = parsed
  const [action] = positionals
  if (values.help || !action) return null
  if (!['on', 'off', 'status'].includes(action)) fail('UNKNOWN_COMMAND', 'Use: release on | off | status')
  const storePath = resolveStorePath(values['store-path'] ?? process.env.VIBEFLOW_STORE_DIR, values.profile)
  setPlatform(createNodePlatform({ userDataDir: storePath }))

  if (action === 'status') {
    const store = getStoreAtPath(storePath)
    const board = normalizeBoard(store.get('board'))
    const release = store.get('release') ?? { enabled: false }
    const batch = release.batchId ? (store.get('batches') ?? []).find((b) => b.id === release.batchId) : undefined
    return {
      enabled: release.enabled,
      batch: batch ? { id: batch.id, startedAt: batch.startedAt, released: batch.taskIds } : null,
      concurrency: resolveAutonomousSettings(store.get('settings')).concurrency,
      occupied: occupiedSlots(board),
      ready: readyCards(board).map((t) => ({ id: t.id, title: t.title })),
    }
  }

  const lock = liveHost(storePath)
  if (!lock) fail('HOST_NOT_RUNNING', `No VibeFlow host is running for ${storePath}. Start it with \`vibeflow\` first.`)
  const remote = connectToHost(lock)
  try {
    const state = await remote.api.setRelease({ enabled: action === 'on' })
    return { enabled: state.release?.enabled ?? false, batchId: state.release?.batchId ?? null }
  } catch (err) {
    if (err instanceof CliFailure) throw err
    const e = err as { code?: string; message?: string }
    fail(e.code ?? 'HOST_ERROR', e.message ?? String(err))
  } finally {
    remote.close()
  }
}
