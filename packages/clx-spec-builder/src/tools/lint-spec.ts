// lint_spec tool - validate OpenAPI spec structure

import { tool } from 'ai';
import { z } from 'zod';
import * as path from 'path';
import { validateOpenApiSpec, validateAdapter } from '../clx-integration/validate.js';

export function createLintSpecTool(clxRoot: string) {
  return tool({
    description: 'Validate the OpenAPI spec and adapter for correctness. Run this before testing API calls.',
    parameters: z.object({
      apiName: z.string().describe('The API name'),
    }),
    execute: async ({ apiName }) => {
      console.log(`\n[Linting spec for: ${apiName}]`);

      const specPath = path.join(clxRoot, 'registry', apiName, 'openapi.yaml');
      const adapterPath = path.join(clxRoot, 'src', 'specs', `${apiName}.ts`);

      // Validate spec
      console.log('[Validating OpenAPI spec...]');
      const specResult = await validateOpenApiSpec(specPath);

      // Validate adapter
      console.log('[Validating adapter...]');
      const adapterResult = await validateAdapter(adapterPath);

      const allErrors = [...specResult.errors, ...adapterResult.errors];
      const allWarnings = [...specResult.warnings, ...adapterResult.warnings];

      return {
        valid: allErrors.length === 0,
        spec: specResult,
        adapter: adapterResult,
        summary: {
          errors: allErrors,
          warnings: allWarnings,
        },
      };
    },
  });
}
