// Stripe API adapter
import { defineAdapter, flattenToFormData, type AdapterContext } from '../../adapter.js';

export default defineAdapter({
  name: 'stripe',
  displayName: 'Stripe',
  spec: './openapi.yaml',

  baseUrl: 'https://api.stripe.com',

  auth: {
    type: 'bearer',
    envVar: 'STRIPE_API_KEY',
    login: {
      prompt: 'Enter your Stripe secret key:',
      hint: 'Get it from https://dashboard.stripe.com/apikeys',
      validate: (key: string) => key.startsWith('sk_'),
      errorMessage: 'Stripe secret keys start with sk_',
    },
  },

  request: {
    headers: (ctx: AdapterContext) => ({
      'Stripe-Version': '2024-01-15',
    }),
    // Stripe uses form encoding, not JSON
    transformBody: (body: unknown) => flattenToFormData(body as Record<string, unknown>),
  },

  content: {
    requestType: 'application/x-www-form-urlencoded',
  },

  response: {
    unwrap: (res: unknown) => res, // Stripe responses are already clean
  },

  pagination: {
    style: 'cursor',
    cursor: {
      param: 'starting_after',
      extract: (res: unknown) => {
        const r = res as { data?: Array<{ id?: string }> };
        return r.data?.[r.data.length - 1]?.id || null;
      },
      hasMore: (res: unknown) => (res as { has_more?: boolean }).has_more || false,
    },
  },

  parameters: {
    alias: {
      'l': 'limit',
    },
    rename: {
      'starting_after': 'after',
      'ending_before': 'before',
    },
  },

  rateLimit: {
    headers: {
      limit: 'X-RateLimit-Limit',
      remaining: 'X-RateLimit-Remaining',
    },
    retry: {
      maxRetries: 3,
      backoff: 'exponential',
    },
  },

  errors: {
    extract: (body: unknown) => {
      const b = body as { error?: { message?: string; code?: string; type?: string } };
      return {
        message: b.error?.message,
        code: b.error?.code,
        type: b.error?.type,
      };
    },
  },

  help: {
    summary: 'Stripe payment processing API',
    docs: 'https://stripe.com/docs/api',
    dashboard: 'https://dashboard.stripe.com',
    examples: [
      { cmd: 'stripe customers list', desc: 'List customers' },
      { cmd: 'stripe customers create --email user@example.com', desc: 'Create a customer' },
      { cmd: 'stripe charges create --amount 2000 --currency usd --source tok_visa', desc: 'Create a charge' },
    ],
  },
});
