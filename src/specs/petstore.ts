// Petstore API adapter - minimal example
import { defineAdapter } from '../core/index.js';

export default defineAdapter({
  name: 'petstore',
  auth: {
    type: 'apiKey',
    header: 'api_key',
    envVar: 'PETSTORE_API_KEY',
  },
});
