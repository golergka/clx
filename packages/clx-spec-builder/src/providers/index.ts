// LLM Provider abstraction

import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModelV1 } from 'ai';

export type ProviderType = 'google' | 'anthropic' | 'openai';

export function getModel(provider: ProviderType): LanguageModelV1 {
  switch (provider) {
    case 'google': {
      const google = createGoogleGenerativeAI({
        apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
      });
      return google('gemini-2.0-flash');
    }
    case 'anthropic': {
      const anthropic = createAnthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
      return anthropic('claude-sonnet-4-20250514');
    }
    case 'openai': {
      const openai = createOpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
      return openai('gpt-4o');
    }
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

export function validateProviderConfig(provider: ProviderType): void {
  const envVars: Record<ProviderType, string> = {
    google: 'GOOGLE_GENERATIVE_AI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
  };

  const envVar = envVars[provider];
  if (!process.env[envVar]) {
    throw new Error(`Missing ${envVar} environment variable for provider: ${provider}`);
  }
}
