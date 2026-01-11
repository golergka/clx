// Confluence Cloud API adapter
// Atlassian Confluence REST API

import { defineAdapter } from '../core/index.js';

export default defineAdapter({
  name: 'confluence',
  displayName: 'Confluence Cloud',

  baseUrl: (ctx) => {
    // Priority: env var → profile config → null (will prompt on login)
    // Confluence uses /wiki path under the same Atlassian domain
    const domain = process.env.ATLASSIAN_DOMAIN
      || process.env.CONFLUENCE_DOMAIN
      || process.env.JIRA_DOMAIN
      || (ctx.config?.domain as string);
    return domain ? `https://${domain}.atlassian.net/wiki` : null;
  },

  auth: {
    type: 'basic',
    envVarUser: 'ATLASSIAN_EMAIL',
    envVarPass: 'ATLASSIAN_API_TOKEN',
    login: {
      hint: 'Create an API token at https://id.atlassian.com/manage-profile/security/api-tokens',
      prompts: [
        {
          name: 'domain',
          prompt: 'Atlassian domain (e.g., yourcompany):',
          validate: (v) => v.length > 0 && !v.includes('.'),
          errorMessage: 'Enter just the subdomain, not the full URL',
        },
        {
          name: 'email',
          prompt: 'Atlassian email:',
          validate: (v) => v.includes('@'),
          errorMessage: 'Enter a valid email address',
        },
        {
          name: 'token',
          prompt: 'API token:',
          secret: true,
          validate: (v) => v.length > 10,
          errorMessage: 'API token seems too short',
        },
      ],
    },
  },

  help: {
    summary: 'Confluence Cloud REST API - Wiki and documentation platform',
    examples: [
      { cmd: 'confluence content search --cql="space=SPACE AND type=page"', desc: 'Search content with CQL' },
      { cmd: 'confluence content getContentById --id=12345', desc: 'Get page content' },
      { cmd: 'confluence content createContent --data=\'{"type":"page",...}\'', desc: 'Create a page' },
      { cmd: 'confluence content updateContent --id=12345 --data=\'{...}\'', desc: 'Update a page' },
    ],
  },
});
