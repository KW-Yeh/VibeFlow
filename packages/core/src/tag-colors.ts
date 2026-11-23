/** The palette a card tag may use. Each name has a `--tag-<name>` token in the renderer. */
export const TAG_COLORS = ['gray', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'purple'] as const

export type TagColor = (typeof TAG_COLORS)[number]

export function isTagColor(value: unknown): value is TagColor {
  return typeof value === 'string' && (TAG_COLORS as readonly string[]).includes(value)
}
