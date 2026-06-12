import { anthropic } from '@ai-sdk/anthropic'
import { gateway } from 'ai'
import type { LanguageModel } from 'ai'
import { env } from '@/env'

const MODEL_ID = 'claude-opus-4-7'
const GATEWAY_MODEL_ID = `anthropic/${MODEL_ID}` as const

const CLASSIFIER_MODEL_ID = 'claude-haiku-4-5'
const CLASSIFIER_GATEWAY_MODEL_ID = `anthropic/${CLASSIFIER_MODEL_ID}` as const

/**
 * Pick the LLM provider based on which key is configured.
 * - AI_GATEWAY_API_KEY → Vercel AI Gateway (preferred for prod: fallback, observability)
 * - ANTHROPIC_API_KEY  → direct Anthropic provider (works for local dev without Vercel)
 *
 * The gateway() helper does NOT fall back to ANTHROPIC_API_KEY when AI_GATEWAY_API_KEY
 * is missing — it throws GatewayAuthenticationError. So we branch explicitly.
 */
export function getModel(): LanguageModel {
  if (env.AI_GATEWAY_API_KEY) {
    return gateway(GATEWAY_MODEL_ID)
  }
  if (env.ANTHROPIC_API_KEY) {
    return anthropic(MODEL_ID)
  }
  throw new Error(
    'No LLM credentials: set AI_GATEWAY_API_KEY (preferred) or ANTHROPIC_API_KEY in .env.local',
  )
}

/**
 * Cheap + fast classifier model (Claude Haiku 4.5).
 * Uses the same gateway/direct fallback logic as getModel().
 */
export function getClassifierModel(): LanguageModel {
  if (env.AI_GATEWAY_API_KEY) {
    return gateway(CLASSIFIER_GATEWAY_MODEL_ID)
  }
  if (env.ANTHROPIC_API_KEY) {
    return anthropic(CLASSIFIER_MODEL_ID)
  }
  throw new Error(
    'No LLM credentials: set AI_GATEWAY_API_KEY (preferred) or ANTHROPIC_API_KEY in .env.local',
  )
}
