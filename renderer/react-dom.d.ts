// react-dom is already a runtime dependency; declare the single API used here
// because this project does not install @types/react-dom.
declare module 'react-dom' {
  import type { Key, ReactNode, ReactPortal } from 'react'
  export function createPortal(children: ReactNode, container: Element | DocumentFragment, key?: Key | null): ReactPortal
}
