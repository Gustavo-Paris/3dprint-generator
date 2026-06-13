import { anthropic } from '@ai-sdk/anthropic'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { gateway } from 'ai'
import type { LanguageModel } from 'ai'
import { env } from '@/env'
import { resolveConfig } from '@/lib/settings/store'

// Legacy/fallback Anthropic ids (used only when no OpenAI-compatible config is set).
const MODEL_ID = 'claude-opus-4-7'
const GATEWAY_MODEL_ID = `anthropic/${MODEL_ID}` as const
const CLASSIFIER_MODEL_ID = 'claude-haiku-4-5'
const CLASSIFIER_GATEWAY_MODEL_ID = `anthropic/${CLASSIFIER_MODEL_ID}` as const

const NO_CREDS =
  'Nenhum modelo de IA configurado. Defina o Provider de IA (base URL + modelo, ' +
  'e a chave se necessário) em Configurações, ou via AI_BASE_URL/AI_MODEL — ou use ' +
  'AI_GATEWAY_API_KEY / ANTHROPIC_API_KEY.'

function openAICompatibleModel(baseURL: string, apiKey: string | null, modelId: string): LanguageModel {
  const provider = createOpenAICompatible({
    name: 'byo',
    baseURL,
    apiKey: apiKey ?? undefined,
  })
  return provider(modelId)
}

/**
 * Main model. Resolution order:
 *  1. Bring-your-own OpenAI-compatible endpoint (Settings UI or AI_BASE_URL+AI_MODEL)
 *  2. Vercel AI Gateway (AI_GATEWAY_API_KEY)
 *  3. Direct Anthropic (ANTHROPIC_API_KEY)
 */
export async function getModel(): Promise<LanguageModel> {
  const cfg = await resolveConfig()
  if (cfg.aiBaseUrl && cfg.aiModel) {
    return openAICompatibleModel(cfg.aiBaseUrl, cfg.aiApiKey, cfg.aiModel)
  }
  if (env.AI_GATEWAY_API_KEY) return gateway(GATEWAY_MODEL_ID)
  if (env.ANTHROPIC_API_KEY) return anthropic(MODEL_ID)
  throw new Error(NO_CREDS)
}

/**
 * Cheap + fast classifier model. Uses the BYO endpoint with the (optional)
 * classifier model id — falling back to the main model id — then the same
 * gateway/Anthropic fallbacks as getModel().
 */
export async function getClassifierModel(): Promise<LanguageModel> {
  const cfg = await resolveConfig()
  if (cfg.aiBaseUrl && (cfg.aiClassifierModel || cfg.aiModel)) {
    return openAICompatibleModel(cfg.aiBaseUrl, cfg.aiApiKey, (cfg.aiClassifierModel || cfg.aiModel)!)
  }
  if (env.AI_GATEWAY_API_KEY) return gateway(CLASSIFIER_GATEWAY_MODEL_ID)
  if (env.ANTHROPIC_API_KEY) return anthropic(CLASSIFIER_MODEL_ID)
  throw new Error(NO_CREDS)
}
