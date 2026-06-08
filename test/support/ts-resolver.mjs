/**
 * ESM resolve hook that lets headless tests import the main-process helpers
 * (`main/helpers/*.ts`) directly.
 *
 * The source files use extensionless relative imports (e.g. `from './env'`)
 * because they are bundled by webpack/nextron for the real build. Node's ESM
 * loader does NOT do extension resolution, so those imports fail under a plain
 * `node --test` run. This hook resolves normally first and, only when that
 * fails for a relative/absolute specifier with no recognised extension, retries
 * with a `.ts` suffix — leaving builtins, node_modules, and already-valid
 * specifiers untouched.
 */
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context)
  } catch (err) {
    const code = err && err.code
    const retriable =
      code === 'ERR_MODULE_NOT_FOUND' || code === 'ERR_UNSUPPORTED_DIR_IMPORT'
    const looksExtensionless =
      /^[./]/.test(specifier) &&
      !/\.[mc]?[jt]s$/.test(specifier) &&
      !/\.json$/.test(specifier) &&
      !specifier.endsWith('/')
    if (retriable && looksExtensionless) {
      return next(specifier + '.ts', context)
    }
    throw err
  }
}
