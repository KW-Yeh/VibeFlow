import type { AppProps } from 'next/app'
import { MotionConfig } from 'motion/react'
import { useEffect } from 'react'

import { prefetchMermaid } from '@/components/mermaid-diagram'

import '@xterm/xterm/css/xterm.css'
import 'react-image-crop/dist/ReactCrop.css'
import '../styles/globals.css'

function MyApp({ Component, pageProps }: AppProps) {
  // Warmed here rather than on first use: a cold chunk makes the first diagram
  // land ~350ms after the text around it, and the panel it sits in grows a
  // second time — long enough apart to read as a scrollbar flicker. Idle so it
  // never competes with the board's own first paint.
  useEffect(() => {
    const handle = requestIdleCallback(prefetchMermaid)
    return () => cancelIdleCallback(handle)
  }, [])

  return (
    <MotionConfig reducedMotion="user">
      <Component {...pageProps} />
    </MotionConfig>
  )
}

export default MyApp
