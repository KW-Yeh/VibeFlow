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

/**
 * Bare, cwd-relative artifacts directory the agent is given when the workspace
 * path is unknown (see renderer/lib/claude.ts ARTIFACTS_FALLBACK_DIR — keep both
 * in sync). Unlike the normal path this one lands inside the worktree, so it is
 * excluded from git (see ensureLocalExclude).
 */
export const ARTIFACTS_FALLBACK_DIR = '.vibeflow-artifacts'

/** How an artifact is presented: rendered inline, as plain text, or not at all. */
export type ArtifactKind = 'image' | 'video' | 'text' | 'binary'

export interface TaskArtifact {
  /** Path relative to the artifacts dir; forward-slash separated, may nest. */
  name: string
  /** Absolute path on disk. */
  path: string
  size: number
  /** Epoch ms of the file's last modification. */
  modifiedAt: number
  kind: ArtifactKind
  /** Images and videos only — the MIME the data URL is built with. */
  mime?: string
  /** True for the agent's own working files (under SCRATCH_DIR_NAME). */
  scratch: boolean
}

export interface ArtifactContent {
  kind: ArtifactKind
  /** Images and videos only: `data:<mime>;base64,…`. */
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

/**
 * Extensions a <video> tag can render, mapped to the MIME the data URL needs.
 * Deliberately short: Electron ships Chromium's proprietary codecs, so H.264 in
 * .mp4/.m4v and VP8/VP9/AV1 in .webm play. Containers Chromium cannot demux
 * (.mkv, .avi) are left out on purpose.
 *
 * .mov maps to video/mp4, not video/quicktime: Chromium's canPlayType rejects
 * video/quicktime outright, but QuickTime and MP4 are both ISO base media, so
 * the MP4 demuxer plays the H.264 .mov that macOS screen recording produces
 * once it is labelled that way (verified in the live app). A .mov carrying a
 * codec Chromium lacks (ProRes) still fails to decode — the player shows that
 * and points at the folder button, which beats hiding the file entirely.
 */
const VIDEO_MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/mp4',
}

/**
 * Videos cross IPC base64-encoded like images, so a long recording would cost
 * ~1.33x its size as a JS string on both sides of the bridge. Past this it is
 * surfaced as 'binary' (name and size only) and the user opens the artifacts
 * folder in the OS file manager to watch it instead.
 */
export const MAX_VIDEO_BYTES = 20 * 1024 * 1024

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
 * Classify a file whose extension says nothing by sampling its head for NUL
 * bytes. Reading a .zip as utf8 yields garbage, so those are surfaced as
 * 'binary' (name and size only) instead of being shown as text.
 */
function mediaKind(
  filePath: string,
  size: number
): { kind: ArtifactKind; mime?: string } | null {
  const extension = path.extname(filePath).toLowerCase()
  const imageMime = IMAGE_MIME[extension]
  if (imageMime) return { kind: 'image', mime: imageMime }
  const videoMime = VIDEO_MIME[extension]
  if (videoMime) {
    return size > MAX_VIDEO_BYTES ? { kind: 'binary' } : { kind: 'video', mime: videoMime }
  }
  return null
}

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
      const media = mediaKind(dirent.name, stat.size)
      found.push({
        name,
        path: full,
        size: stat.size,
        modifiedAt: stat.mtimeMs,
        kind: media ? media.kind : sniffKind(full),
        mime: media?.mime,
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
  let stat: fs.Stats
  try {
    stat = fs.lstatSync(target)
    if (!stat.isFile()) return null
  } catch {
    return null
  }

  try {
    const media = mediaKind(target, stat.size)
    if (media?.mime) {
      return {
        kind: media.kind,
        dataUrl: `data:${media.mime};base64,${fs.readFileSync(target).toString('base64')}`,
      }
    }
    // An oversized video: previewable by extension, too big to inline.
    if (media?.kind === 'binary') return { kind: 'binary' }
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
