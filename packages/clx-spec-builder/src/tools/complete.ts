// complete tool - mark generation as complete with verification

import { tool } from 'ai';
import { z } from 'zod';
import * as path from 'path';
import { typecheckClx } from '../clx-integration/build.js';
import { validateOpenApiSpec, validateAdapter, validateSpecExists, validateAdapterExists } from '../clx-integration/validate.js';
import type { SessionState, CompletionCheck } from '../types.js';

export function createCompleteTool(clxRoot: string, state: SessionState) {
  return tool({
    description: `Signal that spec generation is complete. This will verify:
- OpenAPI spec is valid
- All paths have operationIds
- Adapter has required fields
- At least one API call succeeded
- No TypeScript errors

If any check fails, you'll get an error and should fix the issues before calling this again.`,
    parameters: z.object({
      summary: z.string().describe('Brief summary of what was generated'),
    }),
    execute: async ({ summary }) => {
      console.log('\n[Verifying completion...]');

      const checks: CompletionCheck['checks'] = {
        specValid: false,
        hasOperationIds: false,
        adapterValid: false,
        apiCallSucceeded: false,
        noTypeErrors: false,
      };
      const errors: string[] = [];

      // Check spec exists
      const specExists = await validateSpecExists(clxRoot, state.config.name);
      if (!specExists) {
        errors.push('OpenAPI spec not found');
      } else {
        // Validate spec
        const specPath = path.join(clxRoot, 'registry', state.config.name, 'openapi.yaml');
        const specResult = await validateOpenApiSpec(specPath);
        checks.specValid = specResult.valid;
        checks.hasOperationIds = !specResult.errors.some(e => e.includes('operationId'));

        if (!specResult.valid) {
          errors.push(...specResult.errors);
        }
      }

      // Check adapter exists and is valid
      const adapterExists = await validateAdapterExists(clxRoot, state.config.name);
      if (!adapterExists) {
        errors.push('Adapter not found');
      } else {
        const adapterPath = path.join(clxRoot, 'src', 'specs', `${state.config.name}.ts`);
        const adapterResult = await validateAdapter(adapterPath);
        checks.adapterValid = adapterResult.valid;

        if (!adapterResult.valid) {
          errors.push(...adapterResult.errors);
        }
      }

      // Check API calls
      checks.apiCallSucceeded = state.apiCallsSucceeded > 0;
      if (!checks.apiCallSucceeded) {
        errors.push('No successful API calls during this session. You must test at least one endpoint.');
      }

      // Check TypeScript errors
      const typecheckResult = await typecheckClx(clxRoot);
      checks.noTypeErrors = typecheckResult.success;
      if (!typecheckResult.success) {
        errors.push('TypeScript errors found:');
        errors.push(...typecheckResult.errors.slice(0, 5));
        if (typecheckResult.errors.length > 5) {
          errors.push(`...and ${typecheckResult.errors.length - 5} more errors`);
        }
      }

      const passed = Object.values(checks).every(v => v);

      if (passed) {
        console.log('\n[All checks passed! Generation complete.]');
        return {
          passed: true,
          summary,
          checks,
          stats: {
            apiCallsSucceeded: state.apiCallsSucceeded,
            apiCallsFailed: state.apiCallsFailed,
          },
          files: {
            spec: path.join('registry', state.config.name, 'openapi.yaml'),
            adapter: path.join('src', 'specs', `${state.config.name}.ts`),
          },
        };
      } else {
        console.log('\n[Completion checks failed. Please fix the issues.]');
        return {
          passed: false,
          checks,
          errors,
          message: 'Fix the above issues and try again',
        };
      }
    },
  });
}
