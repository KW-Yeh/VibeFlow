import fs from 'fs'
import path from 'path'

/**
 * Suffix of a task's temporary-artifact directory. Like the progress / plan
 * files it lives in the task's workspace folder (the worktree's parent), named
 * by the worktree folder, so git never sees it and concurrent tasks never
 * collide. Renderer builds the identical path from the same workspace path (see
 * renderer/lib/claude.ts agentFilePaths) — keep both in sync.
 */
export const ARTIFACTS_DIR_SUFFIX = '.artifacts'

/**
 * Subdirectory the agent is told to keep its own working files in (one-off
 * scripts, logs, intermediate output) as opposed to the screenshots and reports
 * it produces for the user. It stays inside the artifacts dir so cleanup is
 * unchanged, but every entry below it is flagged, which lets the listing budget
 * favour user-facing files and lets the UI fold the rest away. Mirrors
 * SCRATCH_DIR_NAME in renderer/lib/claude.ts.
 */
export const SCRATCH_DIR_NAME = 'scratch'

/** How an artifact is presented: rendered inline, as plain text, or not at all. */
export type ArtifactKind = 'image' | 'text' | 'binary'

export interface TaskArtifact {
  /** Path relative to the artifacts dir; forward-slash separated, may nest. */
  name: string
  /** Absolute path on disk. */
  path: string
  size: number
  /** Epoch ms of the file's last modification. */
  modifiedAt: number
  kind: ArtifactKind
  /** Images only — the MIME the data URL is built with. */
  mime?: string
  /** True for the agent's own working files (under SCRATCH_DIR_NAME). */
  scratch: boolean
}

export interface ArtifactContent {
  kind: ArtifactKind
  /** Images only: `data:<mime>;base64,…`. */
  dataUrl?: string
  /** Text only. */
  text?: string
  /** True when `text` was cut at MAX_TEXT_BYTES. */
  truncated?: boolean
}

/** Extensions an <img> tag can render, mapped to the MIME the data URL needs. */
const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
}

/** Text preview cap — a multi-MB log must not cross IPC in full. */
const MAX_TEXT_BYTES = 256 * 1024

/** Walk bounds, so a stray node_modules dumped in here cannot stall the UI. */
const MAX_DEPTH = 3
export const MAX_ARTIFACTS = 200

/** Bytes sampled to tell a text file from a binary one. */
const SNIFF_BYTES = 8 * 1024

/**
 * Absolute path of a task's artifact directory. Mirrors
 * agentProgressPath/agentPlanPath in progress.ts — same naming rule.
 */
export function agentArtifactsPath(baseDir: string, worktreePath: string): string {
  return path.join(baseDir, `${path.basename(worktreePath)}${ARTIFACTS_DIR_SUFFIX}`)
}

/**
 * Classify a non-image file by sampling its head for NUL bytes. Reading a .zip
 * or .mp4 as utf8 yields garbage, so those are surfaced as 'binary' (name and
 * size only) instead of being shown as text.
 */
function sniffKind(filePath: string): 'text' | 'binary' {
  let fd: number | undefined
  try {
    fd = fs.openSync(filePath, 'r')
    const buf = Buffer.alloc(SNIFF_BYTES)
    const read = fs.readSync(fd, buf, 0, SNIFF_BYTES, 0)
    return buf.subarray(0, read).includes(0) ? 'binary' : 'text'
  } catch {
    return 'binary'
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd)
      } catch {
        // already closed / never opened
      }
    }
  }
}

/**
 * Resolve a renderer-supplied `name` inside `dir`, refusing anything that
 * escapes it. Uses realpath so a symlink at any level cannot point outside;
 * requiring existence is fine here because callers only ever read.
 */
function resolveInside(dir: string, name: string): string | null {
  let root: string
  let target: string
  try {
    root = fs.realpathSync(path.resolve(dir))
    target = fs.realpathSync(path.resolve(root, name))
  } catch {
    return null
  }
  if (target !== root && !target.startsWith(root + path.sep)) return null
  return target
}

/**
 * Artifacts in `dir`: user-facing files first, then the agent's scratch files,
 * each group newest first. Metadata only — bytes are fetched per item by
 * readArtifact, so listing a directory of screenshots costs no image data.
 * Returns [] when the directory is absent, which is the common case (the agent
 * has not produced anything yet).
 *
 * The scratch subtree is walked in a second pass so a task that wrote a hundred
 * throwaway scripts cannot push its screenshots past MAX_ARTIFACTS.
 */
export function listArtifacts(dir: string): TaskArtifact[] {
  const found: TaskArtifact[] = []

  const walk = (current: string, prefix: string, depth: number, scratch: boolean): void => {
    if (found.length >= MAX_ARTIFACTS) return
    let dirents: fs.Dirent[]
    try {
      dirents = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const dirent of dirents) {
      if (found.length >= MAX_ARTIFACTS) return
      const name = prefix ? `${prefix}/${dirent.name}` : dirent.name
      const full = path.join(current, dirent.name)
      if (dirent.isDirectory()) {
        if (!scratch && depth === 1 && dirent.name === SCRATCH_DIR_NAME) continue
        if (depth < MAX_DEPTH) walk(full, name, depth + 1, scratch)
        continue
      }
      // Regular files only — symlinks, sockets and fifos are not artifacts.
      if (!dirent.isFile()) continue
      let stat: fs.Stats
      try {
        stat = fs.statSync(full)
      } catch {
        continue
      }
      const mime = IMAGE_MIME[path.extname(dirent.name).toLowerCase()]
      found.push({
        name,
        path: full,
        size: stat.size,
        modifiedAt: stat.mtimeMs,
        kind: mime ? 'image' : sniffKind(full),
        mime,
        scratch,
      })
    }
  }

  walk(dir, '', 1, false)
  walk(path.join(dir, SCRATCH_DIR_NAME), SCRATCH_DIR_NAME, 2, true)
  return found.sort(
    (a, b) => Number(a.scratch) - Number(b.scratch) || b.modifiedAt - a.modifiedAt
  )
}

/** Content of one artifact; null when absent, not a regular file, or escaping `dir`. */
export function readArtifact(dir: string, name: string): ArtifactContent | null {
  const target = resolveInside(dir, name)
  if (!target) return null
  try {
    if (!fs.lstatSync(target).isFile()) return null
  } catch {
    return null
  }

  const mime = IMAGE_MIME[path.extname(target).toLowerCase()]
  try {
    if (mime) {
      return {
        kind: 'image',
        dataUrl: `data:${mime};base64,${fs.readFileSync(target).toString('base64')}`,
      }
    }
    if (sniffKind(target) === 'binary') return { kind: 'binary' }
    const buf = fs.readFileSync(target)
    return {
      kind: 'text',
      text: buf.subarray(0, MAX_TEXT_BYTES).toString('utf8'),
      truncated: buf.byteLength > MAX_TEXT_BYTES,
    }
  } catch {
    return null
  }
}

/**
 * Best-effort removal of a task's artifact directory. Called from
 * deleteAgentFiles so temporary artifacts share the worktree's lifecycle.
 */
export function deleteArtifacts(baseDir: string, worktreePath: string): void {
  try {
    fs.rmSync(agentArtifactsPath(baseDir, worktreePath), {
      recursive: true,
      force: true,
    })
  } catch {
    // best-effort — a missing dir or unlink race must not fail teardown
  }
}
