import type { AppProps } from 'next/app'

import '@xterm/xterm/css/xterm.css'
import 'react-image-crop/dist/ReactCrop.css'
import '../styles/globals.css'

function MyApp({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />
}

export default MyApp
