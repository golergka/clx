// Jira Cloud API adapter
// Atlassian Jira REST API

import { defineAdapter } from '../core/index.js';

export default defineAdapter({
  name: 'jira',
  displayName: 'Jira Cloud',

  baseUrl: (ctx) => {
    // Priority: env var → profile config → null (will prompt on login)
    const domain = process.env.ATLASSIAN_DOMAIN
      || process.env.JIRA_DOMAIN
      || (ctx.config?.domain as string);
    return domain ? `https://${domain}.atlassian.net` : null;
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
    summary: 'Jira Cloud REST API - Issue tracking and project management',
    examples: [
      { cmd: 'jira search searchForIssuesUsingJql --jql="project=PROJ"', desc: 'Search issues with JQL' },
      { cmd: 'jira issue getIssue --issueIdOrKey=PROJ-123', desc: 'Get issue details' },
      { cmd: 'jira issue createIssue --data=\'{"fields":{...}}\'', desc: 'Create an issue' },
      { cmd: 'jira issue editIssue --issueIdOrKey=PROJ-123 --data=\'{...}\'', desc: 'Update an issue' },
      { cmd: 'jira issue doTransition --issueIdOrKey=PROJ-123 --data=\'{...}\'', desc: 'Transition issue status' },
    ],
  },
});
