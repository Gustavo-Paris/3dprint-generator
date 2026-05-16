import { z } from 'zod'

const schema = z.object({
  DATABASE_URL: z.string().url(),
  AUTH_SECRET: z.string().min(1),
  AUTH_RESEND_KEY: z.string().min(1),
  AUTH_EMAIL_FROM: z.string().email(),
  AUTH_ALLOWED_EMAILS: z.string().min(1),
  AI_GATEWAY_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  E2E_ALLOW_TEST_LOGIN: z.string().optional(),
  SLICER_URL: z.string().url().default('http://localhost:8787'),
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
  MESHY_API_KEY: z.string().optional(),
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  console.error('Invalid env:', parsed.error.flatten().fieldErrors)
  throw new Error('Invalid environment variables')
}

export const env = parsed.data

export const allowedEmails = new Set(
  env.AUTH_ALLOWED_EMAILS.split(',').map((e) => e.trim().toLowerCase()),
)
