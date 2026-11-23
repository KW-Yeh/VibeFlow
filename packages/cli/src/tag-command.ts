import { parseArgs } from 'node:util'
import { getStoreAtPath } from '../../core/src/store'
import { createTag, deleteTag, listTags, updateTag } from '../../core/src/tags'
import { TAG_COLORS } from '../../core/src/tag-colors'
import { fail, requireOneOf, resolveStorePath } from './task-command'

export const TAG_USAGE = `
VibeFlow tag commands — the board's tags, offered to every card

Usage:
  vibeflow tag list [options]
  vibeflow tag create --name <text> [--color <color>] [options]
  vibeflow tag update --tag <name|id> [--name <text>] [--color <color>] [options]
  vibeflow tag delete --tag <name|id> [options]

Options:
  --name <text>        Tag name; unique ignoring case
  --tag <name|id>      Tag to change; names match ignoring case
  --color <color>      ${TAG_COLORS.join(' | ')}  (create default: the least used one)
  --store-path <dir>   Store directory (defaults to VIBEFLOW_STORE_DIR in a task shell)
  --profile <name>     dev | prod — when no store path is given
  -h, --help           Show this help

  Deleting a tag also takes it off every card. To put tags on a card, use
  vibeflow task tag --task <id> --add <tag>. No running host is needed; an open
  board shows the change on its own.
`.trim()

const ACTIONS = ['list', 'create', 'update', 'delete']

/** `vibeflow tag …`. Writes one JSON object to stdout, like `vibeflow task`, and resolves to the exit code. */
export async function runTagCommand(argv: string[]): Promise<number> {
  try {
    const result = tagCommand(argv)
    if (result === null) {
      console.log(TAG_USAGE)
      return 0
    }
    process.stdout.write(JSON.stringify({ ok: true, ...result }, null, 2) + '\n')
    return 0
  } catch (err) {
    const e = err as { code?: string; message?: string }
    process.stdout.write(
      JSON.stringify({ ok: false, error: { code: e.code ?? 'UNKNOWN_ERROR', message: e.message ?? String(err) } }) + '\n'
    )
    return 1
  }
}

function tagCommand(argv: string[]): Record<string, unknown> | null {
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        name:         { type: 'string' },
        tag:          { type: 'string' },
        color:        { type: 'string' },
        'store-path': { type: 'string' },
        profile:      { type: 'string' },
        help:         { type: 'boolean', short: 'h' },
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
  if (!ACTIONS.includes(action)) fail('UNKNOWN_COMMAND', `Unknown command: "tag ${action}". Use: ${ACTIONS.map((a) => `tag ${a}`).join(' | ')}`)
  requireOneOf('--color', values.color, TAG_COLORS)

  const store = getStoreAtPath(resolveStorePath(values['store-path'] ?? process.env.VIBEFLOW_STORE_DIR, values.profile))
  if (action === 'list') return { storePath: store.path, tags: listTags(store) }
  if (action === 'create') {
    if (values.name === undefined) fail('MISSING_ARGUMENT', 'tag create needs --name')
    return { storePath: store.path, tag: createTag(store, { name: values.name, color: values.color }) }
  }
  if (!values.tag) fail('MISSING_ARGUMENT', `tag ${action} needs --tag`)
  if (action === 'update') {
    if (values.name === undefined && values.color === undefined) fail('MISSING_ARGUMENT', 'tag update needs --name or --color')
    return { storePath: store.path, tag: updateTag(store, values.tag, { name: values.name, color: values.color }) }
  }
  return { storePath: store.path, deleted: deleteTag(store, values.tag) }
}
