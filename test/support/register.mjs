import { register } from 'node:module'

// Registered via NODE_OPTIONS=--import so the hook is active in the test
// runner process AND in every test file (see package.json `test` script).
register('./ts-resolver.mjs', import.meta.url)
