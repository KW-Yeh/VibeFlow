import type { EventSink } from './events'
import { PtyBackend } from './pty'
import type { SessionBackend } from './session-backend'
import { hasTmux, TmuxBackend } from './tmux-backend'

export interface SessionBackendChoice {
  /**
   * `auto` = tmux when it is installed (never on Windows), else node-pty.
   * `tmux` falls back to node-pty too when tmux is missing.
   */
  prefer: 'auto' | 'tmux' | 'pty'
  /** Where TmuxBackend keeps its config, logs and exit-status files. */
  stateDir: string
}

export function createSessionBackend(sink: EventSink, choice: SessionBackendChoice): SessionBackend {
  if (choice.prefer !== 'pty' && hasTmux()) {
    return new TmuxBackend(sink, { stateDir: choice.stateDir })
  }
  return new PtyBackend(sink)
}
