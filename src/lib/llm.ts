import { gateway } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';

export interface ProviderConfig {
  type: 'gateway' | 'openai-compatible';
  model: string;
  baseUrl?: string;
  apiKey?: string;
  name?: string;
}

const PRESETS: Record<string, { baseUrl: string; name: string }> = {
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', name: 'openrouter' },
  ollama: { baseUrl: 'http://localhost:11434/v1', name: 'ollama' },
  lmstudio: { baseUrl: 'http://localhost:1234/v1', name: 'lmstudio' },
  groq: { baseUrl: 'https://api.groq.com/openai/v1', name: 'groq' },
  together: { baseUrl: 'https://api.together.xyz/v1', name: 'together' },
};

export function resolveBaseUrl(cfg: ProviderConfig): string | undefined {
  if (cfg.baseUrl) return cfg.baseUrl;
  if (cfg.type === 'openai-compatible') {
    const preset = cfg.name ? PRESETS[cfg.name.toLowerCase()] : undefined;
    return preset?.baseUrl;
  }
  return undefined;
}

export function buildModel(cfg: ProviderConfig | null): LanguageModel {
  if (!cfg) {
    return gateway(process.env.AI_MODEL || 'anthropic/claude-sonnet-4.5');
  }
  if (cfg.type === 'gateway') {
    return gateway(cfg.model || process.env.AI_MODEL || 'anthropic/claude-sonnet-4.5');
  }
  const baseURL = resolveBaseUrl(cfg);
  if (!baseURL) throw new Error('baseUrl required for openai-compatible provider');
  const provider = createOpenAICompatible({
    name: cfg.name || 'custom',
    baseURL,
    apiKey: cfg.apiKey || '',
  });
  return provider.chatModel(cfg.model);
}
