const MINIMUM_TERMINAL_COLUMNS = 2

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
