import type { AppProps } from 'next/app'
import { MotionConfig } from 'motion/react'

import '@xterm/xterm/css/xterm.css'
import 'react-image-crop/dist/ReactCrop.css'
import '../styles/globals.css'

function MyApp({ Component, pageProps }: AppProps) {
  return (
    <MotionConfig reducedMotion="user">
      <Component {...pageProps} />
    </MotionConfig>
  )
}

export default MyApp
