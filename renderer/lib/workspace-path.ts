/** Last path segment of a filesystem path, tolerant of both separators. */
export function basenameFromPath(path: string): string {
  const parts = path.split(/[/\\]/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}
