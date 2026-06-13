import { z } from 'zod'

const schema = z.object({
  DATABASE_URL: z.string().url(),
  AUTH_SECRET: z.string().min(1),
  // Canonical origin (e.g. https://app.example.com). When set, NextAuth builds
  // callback/magic-link URLs from it and IGNORES the client-supplied Host header,
  // closing the Host-injection -> magic-link token-exfiltration vector that bare
  // `trustHost: true` would otherwise leave open. Required in production (enforced
  // below); optional in dev where trustHost handles localhost.
  AUTH_URL: z.string().url().optional(),
  AUTH_RESEND_KEY: z.string().min(1),
  AUTH_EMAIL_FROM: z.string().email(),
  AUTH_ALLOWED_EMAILS: z.string().min(1),
  // Only this email may change instance Settings (shared singleton: API keys,
  // base URLs). Optional — defaults to the FIRST entry of AUTH_ALLOWED_EMAILS,
  // so a single-user self-host needs no extra config.
  ADMIN_EMAIL: z.string().optional(),
  // Bring-your-own AI (OpenAI-compatible: OpenAI, OpenRouter, Together, Groq,
  // local Ollama/LM Studio, …). Set via these env vars OR the in-app Settings
  // page (which takes precedence). AI_BASE_URL + AI_MODEL enable this path.
  AI_BASE_URL: z.string().url().optional(),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().optional(),
  AI_CLASSIFIER_MODEL: z.string().optional(),
  // Legacy/alternate AI paths (still supported as fallbacks).
  AI_GATEWAY_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  MESHY_API_KEY: z.string().optional(),
  E2E_ALLOW_TEST_LOGIN: z.string().optional(),
  SLICER_URL: z.string().url().default('http://localhost:8787'),
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  console.error('Invalid env:', parsed.error.flatten().fieldErrors)
  throw new Error('Invalid environment variables')
}

// When actually serving in production, AUTH_URL must pin the canonical origin so
// NextAuth never trusts a client-supplied Host header for magic-link callbacks.
// trustHost alone is not a mitigation (same switch as AUTH_TRUST_HOST). Enforce at
// serve time only — `next build` also sets NODE_ENV=production but has no incoming
// requests, so exempt the build phase to avoid breaking CI/local builds.
const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build'
if (process.env.NODE_ENV === 'production' && !isBuildPhase && !parsed.data.AUTH_URL) {
  throw new Error(
    'AUTH_URL must be set in production (canonical origin, e.g. https://app.example.com) — ' +
      'it pins magic-link callback URLs against Host-header injection.',
  )
}

export const env = parsed.data

export const allowedEmails = new Set(
  env.AUTH_ALLOWED_EMAILS.split(',').map((e) => e.trim().toLowerCase()),
)

// Admin = ADMIN_EMAIL if set, else the first entry of the allowlist. Only the
// admin may read/change instance Settings (the shared app_settings singleton).
export const adminEmail =
  env.ADMIN_EMAIL?.trim().toLowerCase() ||
  env.AUTH_ALLOWED_EMAILS.split(',')[0]?.trim().toLowerCase() ||
  null

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && !!adminEmail && email.trim().toLowerCase() === adminEmail
}
