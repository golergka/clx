// Petstore API adapter - minimal example
import { defineAdapter } from '../../adapter.js';

export default defineAdapter({
  name: 'petstore',
  displayName: 'Petstore',
  spec: './openapi.yaml',

  baseUrl: 'https://petstore3.swagger.io/api/v3',

  auth: {
    type: 'apiKey',
    header: 'api_key',
    envVar: 'PETSTORE_API_KEY',
    login: {
      prompt: 'Enter your Petstore API key:',
      hint: 'You can use any string for testing',
    },
  },

  help: {
    summary: 'Swagger Petstore demo API',
    docs: 'https://petstore3.swagger.io/',
    examples: [
      { cmd: 'petstore pet get 1', desc: 'Get pet by ID' },
      { cmd: 'petstore pet findByStatus --status available', desc: 'Find available pets' },
    ],
  },
});
