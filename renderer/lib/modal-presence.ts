/**
 * Whether a modal is currently covering the app.
 *
 * Background polls read this to skip a round while the user cannot see the
 * result: a poll that adopts fresh data behind a modal resizes a scroll
 * container nobody is looking at, and macOS flashes that container's overlay
 * scrollbar through the translucent backdrop.
 *
 * Deliberately not React state — the answer is only ever needed inside a timer
 * callback, and making it reactive would repaint every panel on open and close.
 */
let openCount = 0

/** Call on mount; the returned function must run on unmount. */
export function acquireModalPresence(): () => void {
  openCount += 1
  let released = false
  return () => {
    if (released) return
    released = true
    openCount -= 1
  }
}

export function isModalOpen(): boolean {
  return openCount > 0
}
