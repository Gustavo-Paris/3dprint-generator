import { z } from 'zod'

const uuidSchema = z.string().uuid()

/** True when `value` is a canonical UUID — use to guard `uuid` DB columns. */
export function isUuid(value: string): boolean {
  return uuidSchema.safeParse(value).success
}
