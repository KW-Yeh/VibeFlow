import { parseArgs } from 'node:util'
import { liveHost } from '../../core/src/lock'
import { createNodePlatform, setPlatform } from '../../core/src/platform'
import { getStoreAtPath, normalizeBoard, resolveAutonomousSettings } from '../../core/src/store'
import { occupiedSlots, dispatchable } from '../../core/src/release'
import { connectToHost } from './remote'
import { isReportId, readReport } from '../../core/src/report'
import { CliFailure, fail, resolveStorePath } from './task-command'

export const DISPATCH_USAGE = `
VibeFlow night shift (下班派工)

Usage:
  vibeflow dispatch [options]          Open a night-shift batch and send tonight's cards out:
                                       every 準備開工 card in 待辦, then In Progress
                                       cards marked to go again, up to the concurrency limit.
                                       The batch closes itself once every card it sent stopped
                                       (已開 PR / 卡住 / 待你確認) and the morning report is written
  vibeflow dispatch --stop [options]   Send nothing more; running cards carry on. The batch
                                       closes and its report is written
  vibeflow dispatch --status [options] Whether a night shift is on, slots and tonight's cards

  Fails with NOTHING_READY when no card is marked for tonight. Mark one with
  \`vibeflow task status --set ready\` or \`task create --ready\`.
  dispatch / --stop need the running VibeFlow host; --status reads the store.

Options:
  --store-path <dir>     Store directory (defaults to VIBEFLOW_STORE_DIR in a task shell)
  --profile <name>       dev | prod
  -h, --help             Show this help
`.trim()

/** \`vibeflow dispatch\` is \`release on\`; --stop and --status map to off and status. */
export async function runDispatchCommand(argv: string[]): Promise<number> {
  if (argv.includes('-h') || argv.includes('--help')) {
    console.log(DISPATCH_USAGE)
    return 0
  }
  const stop = argv.includes('--stop')
  const status = argv.includes('--status')
  if (stop && status) {
    process.stdout.write(JSON.stringify({ ok: false, error: { code: 'INVALID_ARGUMENT', message: '--stop and --status cannot be used together' } }) + '\n')
    return 1
  }
  const rest = argv.filter((a) => a !== '--stop' && a !== '--status')
  return runReleaseCommand([stop ? 'off' : status ? 'status' : 'on', ...rest])
}

export const RELEASE_USAGE = `
VibeFlow release switch (same as \`vibeflow dispatch\`)

Usage:
  vibeflow release on [options]       下班派工: open a batch and send tonight's 準備開工 cards
                                      out up to the concurrency limit; it closes itself once
                                      every card it sent stopped
  vibeflow release off [options]      Stop sending; running cards carry on. The batch
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
      ready: dispatchable(board).map((t) => ({ id: t.id, title: t.title })),
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

export const REPORT_USAGE = `
VibeFlow batch reports

Usage:
  vibeflow report list [options]                 Reports, newest first (complete or 待補寫)
  vibeflow report show --report <id> [options]   One report's markdown on stdout

  A night shift's morning report is written when its batch closes. No host needed.

Options:
  --store-path <dir>     Store directory (defaults to VIBEFLOW_STORE_DIR in a task shell)
  --profile <name>       dev | prod
  -h, --help             Show this help
`.trim()

export async function runReportCommand(argv: string[]): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        report: { type: 'string' },
        'store-path': { type: 'string' },
        profile: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: true,
      strict: true,
    })
  } catch (err) {
    process.stdout.write(JSON.stringify({ ok: false, error: { code: 'INVALID_ARGUMENT', message: (err as Error).message } }) + '\n')
    return 1
  }
  const { values, positionals } = parsed
  const [action] = positionals
  if (values.help || !action) {
    console.log(REPORT_USAGE)
    return 0
  }
  const storePath = resolveStorePath(values['store-path'] ?? process.env.VIBEFLOW_STORE_DIR, values.profile)
  const store = getStoreAtPath(storePath)
  const entries = store.get('reports') ?? []
  const failWith = (code: string, message: string) => {
    process.stdout.write(JSON.stringify({ ok: false, error: { code, message } }) + '\n')
    return 1
  }
  if (action === 'list') {
    process.stdout.write(JSON.stringify({ ok: true, reports: entries }, null, 2) + '\n')
    return 0
  }
  if (action !== 'show') return failWith('UNKNOWN_COMMAND', 'Use: report list | show --report <id>')
  if (!values.report || !isReportId(values.report)) return failWith('MISSING_ARGUMENT', 'report show needs --report <id>')
  const report = readReport(storePath, entries, values.report)
  if (!report) return failWith('REPORT_NOT_FOUND', `Report not found: ${values.report}`)
  process.stdout.write(report.markdown)
  return 0
}
