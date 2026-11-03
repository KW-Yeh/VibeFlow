const MINIMUM_TERMINAL_COLUMNS = 2

/**
 * Resolve once `element` is laid out with a non-zero box, or when `signal`
 * aborts first.
 *
 * Attaching to a tmux session sizes its window to the newest client, so a
 * terminal on a hidden page must not attach before it knows its real size.
 */
export function waitForLayoutBox(element: HTMLElement, signal: AbortSignal): Promise<void> {
  const hasBox = () => element.clientWidth > 0 && element.clientHeight > 0
  if (hasBox() || signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const observer = new ResizeObserver(() => {
      if (hasBox()) finish()
    })
    const finish = () => {
      observer.disconnect()
      signal.removeEventListener('abort', finish)
      resolve()
    }
    signal.addEventListener('abort', finish)
    observer.observe(element)
  })
}

/**
 * Return a column count whose rendered screen fits inside the viewport.
 *
 * FitAddon reserves a fixed scrollbar width, while Chromium's actual native
 * scrollbar can differ by a pixel. That small mismatch is enough to clip the
 * final stroke of the rightmost terminal cell.
 */
export function fitColumnsWithinViewport(
  cols: number,
  screenWidth: number,
  viewportWidth: number
): number {
  if (
    !Number.isFinite(cols) ||
    !Number.isFinite(screenWidth) ||
    !Number.isFinite(viewportWidth) ||
    cols <= MINIMUM_TERMINAL_COLUMNS ||
    screenWidth <= 0 ||
    viewportWidth <= 0 ||
    screenWidth <= viewportWidth
  ) {
    return cols
  }

  const cellWidth = screenWidth / cols
  const overflowingColumns = Math.ceil((screenWidth - viewportWidth) / cellWidth)
  return Math.max(MINIMUM_TERMINAL_COLUMNS, cols - overflowingColumns)
}
