/**
 * SECURITY-CRITICAL FILE
 *
 * Purpose: compile a string of model-generated JavaScript into a callable
 * function. This is the ONLY place in the codebase allowed to do dynamic
 * code compilation. All other code paths must go through compileUserModule().
 *
 * Threat model:
 *   - Runs inside a dedicated Web Worker (no DOM, no document, no window).
 *   - Caller is an allowlisted, authenticated user. There is no public signup.
 *   - The output is a Float32Array of vertex positions — no objects, no callbacks.
 *   - The Worker does not import network APIs from this file; the system prompt
 *     forbids fetch/XHR usage and the runner does not pass any network globals.
 *
 * Hardening backlog (Phase 5):
 *   - Move into an OffscreenCanvas iframe with a strict CSP that disables fetch.
 *   - Or swap for an SES (Hardened JavaScript) realm.
 */

type UserModule = { main?: () => unknown }

export function compileUserModule(
  source: string,
): (jscad: unknown) => UserModule {
  const FunctionCtor = (function () {}).constructor as new (
    ...args: string[]
  ) => (...args: unknown[]) => unknown

  const compiled = new FunctionCtor(
    'jscad',
    'module',
    'exports',
    `${source}\nreturn module.exports;`,
  )

  return (jscad: unknown) => {
    const exportsObj: UserModule = {}
    const moduleObj = { exports: exportsObj }
    return compiled(jscad, moduleObj, exportsObj) as UserModule
  }
}
