// GitHub API adapter
import { defineAdapter } from '../../adapter.js';

export default defineAdapter({
  name: 'github',
  displayName: 'GitHub',
  spec: './openapi.yaml',

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
      // GitHub uses 'repos/list' style operationIds
      return operationId.replace(/\//g, ' ').replace(/-/g, ' ');
    },
  },

  errors: {
    messagePath: 'message',
  },

  help: {
    summary: 'GitHub REST API',
    docs: 'https://docs.github.com/en/rest',
    examples: [
      { cmd: 'github repos list', desc: 'List your repositories' },
      { cmd: 'github users get --username octocat', desc: 'Get user info' },
    ],
  },
});
