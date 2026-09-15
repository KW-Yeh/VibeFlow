import { useEffect, useId, useState } from 'react'

import { cn } from '@/lib/utils'

/**
 * A ```mermaid fence, drawn as SVG.
 *
 * mermaid is imported dynamically, never at module scope: it is the single
 * heaviest thing the renderer can pull in and has no place in the initial
 * bundle. It also touches the DOM to measure text, so it cannot run during the
 * static export — same reason task-terminal.tsx defers xterm. The chunk is
 * warmed once the app goes idle (see pages/_app.tsx), so the first diagram
 * draws with the text around it rather than pushing the layout a second time.
 *
 * The output stays inert, which is what lets it be injected into markdown that
 * otherwise forbids raw HTML (see markdown-body.tsx): `securityLevel: 'strict'`
 * sanitises the generated markup, and `htmlLabels: false` keeps labels as SVG
 * text instead of embedded HTML.
 */

let loading: Promise<typeof import('mermaid').default> | null = null

/** Resolve a design token to a literal colour — mermaid does colour maths on
 *  these values and cannot see through `var()`. */
function token(styles: CSSStyleDeclaration, name: string, fallback: string) {
  return styles.getPropertyValue(name).trim() || fallback
}

/**
 * Warm mermaid before a diagram asks for it — see pages/_app.tsx.
 *
 * The throwaway render is the point: loading the chunk costs ~150ms but
 * mermaid's own first render costs another ~200ms of parser and font setup, and
 * only doing both here keeps that off the first real diagram.
 */
export function prefetchMermaid(): void {
  void loadMermaid()
    .then((mermaid) => mermaid.render('mermaid-warmup', 'flowchart TD\n  A-->B'))
    .catch(() => {})
}

function loadMermaid() {
  loading ??= import('mermaid')
    .then(({ default: mermaid }) => {
      const styles = getComputedStyle(document.documentElement)
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        suppressErrorRendering: true,
        // Root-level, not `flowchart.htmlLabels`: the per-diagram key is
        // deprecated in mermaid 12 and the unified renderer ignores it.
        htmlLabels: false,
        theme: 'dark',
        darkMode: true,
        fontFamily: token(styles, '--font-sans', 'Inter, system-ui, sans-serif'),
        themeVariables: {
          background: token(styles, '--card', '#212121'),
          primaryColor: token(styles, '--secondary', '#262626'),
          primaryTextColor: token(styles, '--foreground', '#ededed'),
          lineColor: token(styles, '--muted-foreground', '#a1a1a1'),
          // Edge labels sit on top of their line and need an opaque mask; the
          // dark theme's default is a light chip that reads as a highlight here.
          edgeLabelBackground: token(styles, '--card', '#212121'),
        },
        flowchart: { useMaxWidth: true },
      })
      return mermaid
    })
    // A failed warm-up must not be cached, or every later diagram in this
    // session inherits it without anyone having seen the error.
    .catch((cause: unknown) => {
      loading = null
      throw cause
    })
  return loading
}

export default function MermaidDiagram({
  code,
  compact,
}: {
  code: string
  compact: boolean
}) {
  // mermaid uses the id as a DOM id and a CSS selector, so the colons React
  // puts in useId() values have to go.
  const domId = `mermaid-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setSvg(null)
    setError(null)
    loadMermaid()
      .then((mermaid) => mermaid.render(domId, code))
      .then((result) => {
        if (!cancelled) setSvg(result.svg)
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      })
    return () => {
      cancelled = true
    }
  }, [code, domId])

  const source = (
    <pre
      className={cn(
        'max-w-full overflow-x-auto rounded-md bg-background/70 p-3',
        compact ? 'text-xs leading-snug' : 'text-sm'
      )}
    >
      <code>{code}</code>
    </pre>
  )

  if (error) {
    return (
      <div className="not-prose my-3 space-y-2">
        <p className="text-xs text-destructive">圖表語法錯誤：{error}</p>
        {source}
      </div>
    )
  }

  if (!svg) {
    return (
      <div className="not-prose my-3 rounded-md bg-background/70 p-3 text-xs text-muted-foreground">
        繪製圖表中…
      </div>
    )
  }

  return (
    <div
      className="not-prose my-3 max-w-full overflow-x-auto rounded-md bg-card p-3 [&_svg]:max-w-full"
      // mermaid output, sanitised by its own strict security level.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
