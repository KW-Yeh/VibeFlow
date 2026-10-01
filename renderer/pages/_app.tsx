import type { AppProps } from 'next/app'
import Head from 'next/head'
import { MotionConfig } from 'motion/react'
import { useEffect, useState } from 'react'

import { prefetchMermaid } from '@/components/mermaid-diagram'
import { CONNECTION_EVENT, installWebBridge } from '@/lib/web-bridge'

import '@xterm/xterm/css/xterm.css'
import 'react-image-crop/dist/ReactCrop.css'
import '../styles/globals.css'

// Before the first render: components read `window.vibeflow` as they mount.
installWebBridge()

/** Shown while the Web UI has lost its WebSocket to core; it reconnects by itself. */
function ConnectionBanner() {
  const [connected, setConnected] = useState(true)
  useEffect(() => {
    const onChange = (e: Event) => setConnected((e as CustomEvent<{ connected: boolean }>).detail.connected)
    window.addEventListener(CONNECTION_EVENT, onChange)
    return () => window.removeEventListener(CONNECTION_EVENT, onChange)
  }, [])
  if (connected) return null
  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-50 bg-destructive px-4 py-1.5 text-center text-sm text-destructive-foreground"
    >
      與 VibeFlow core 的連線中斷，正在重新連線…（agent 仍在背景執行）
    </div>
  )
}

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
      <Head>
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" href="/logo.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      </Head>
      <ConnectionBanner />
      <Component {...pageProps} />
    </MotionConfig>
  )
}

export default MyApp
