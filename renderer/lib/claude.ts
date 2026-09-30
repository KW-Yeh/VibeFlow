// Launch-command assembly lives in core, which builds the command a session
// runs. The renderer still reads a few of its pure helpers (session ids,
// artifact paths, agent names) for display.
export * from '../../packages/core/src/launch'
