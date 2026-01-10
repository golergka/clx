// GitHub API adapter
import { defineAdapter } from '../core/index.js';

export default defineAdapter({
  name: 'github',
  displayName: 'GitHub',

  baseUrl: 'https://api.github.com',

  auth: {
    type: 'bearer',
    envVar: 'GITHUB_TOKEN',
    login: {
      prompt: 'Enter your GitHub personal access token:',
      hint: 'Create one at https://github.com/settings/tokens',
    },
  },

  request: {
    headers: {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  },

  pagination: {
    style: 'link',
    link: {
      rel: 'next',
    },
  },

  rateLimit: {
    headers: {
      limit: 'X-RateLimit-Limit',
      remaining: 'X-RateLimit-Remaining',
      reset: 'X-RateLimit-Reset',
    },
  },

  commands: {
    mode: 'transform',
    transform: (operationId: string) => {
      return operationId.replace(/\//g, ' ').replace(/-/g, ' ');
    },
  },

  errors: {
    messagePath: 'message',
  },

  help: {
    summary: 'GitHub REST API',
    docs: 'https://docs.github.com/en/rest',
  },
});
