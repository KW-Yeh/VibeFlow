import test from 'node:test'
import assert from 'node:assert/strict'

import { fitColumnsWithinViewport } from '../renderer/lib/terminal-fit.ts'

test('fitColumnsWithinViewport keeps columns when the screen is fully visible', () => {
  assert.equal(fitColumnsWithinViewport(80, 563, 563), 80)
  assert.equal(fitColumnsWithinViewport(80, 560, 563), 80)
})

test('fitColumnsWithinViewport removes the column clipped by scrollbar rounding', () => {
  assert.equal(fitColumnsWithinViewport(80, 564, 563), 79)
})

test('fitColumnsWithinViewport removes enough columns for larger overflows', () => {
  assert.equal(fitColumnsWithinViewport(80, 564, 549), 77)
})

test('fitColumnsWithinViewport ignores unusable measurements and keeps the minimum', () => {
  assert.equal(fitColumnsWithinViewport(80, 0, 563), 80)
  assert.equal(fitColumnsWithinViewport(80, Number.NaN, 563), 80)
  assert.equal(fitColumnsWithinViewport(2, 20, 1), 2)
})
