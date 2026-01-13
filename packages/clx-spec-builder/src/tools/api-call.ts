// api_call tool - calls API through clx code path

import { tool } from 'ai';
import { z } from 'zod';
import { buildClx, typecheckClx } from '../clx-integration/build.js';
import { executeApiCall } from '../clx-integration/execute.js';
import type { SessionState } from '../types.js';

export function createApiCallTool(clxRoot: string, state: SessionState) {
  return tool({
    description: `Call an API endpoint through the clx code path. This will:
1. Rebuild the clx project (and return build errors if any)
2. Load your generated spec and adapter
3. Execute the API call
4. Return the response (or errors)

Use this to test that your generated spec actually works.`,
    parameters: z.object({
      operationId: z.string().describe('The operationId from the OpenAPI spec'),
      parameters: z.record(z.string()).optional().describe('Path and query parameters'),
      body: z.any().optional().describe('Request body for POST/PUT/PATCH'),
      auth: z.object({
        token: z.string().optional(),
        username: z.string().optional(),
        password: z.string().optional(),
      }).optional().describe('Authentication credentials'),
    }),
    execute: async ({ operationId, parameters = {}, body, auth }) => {
      console.log(`\n[Testing API: ${operationId}]`);

      // Step 1: Typecheck the project
      console.log('[Step 1/3: Typechecking clx project...]');
      const typecheckResult = await typecheckClx(clxRoot);

      if (!typecheckResult.success) {
        console.log('[Typecheck failed]');
        state.apiCallsFailed++;
        return {
          success: false,
          phase: 'typecheck',
          errors: typecheckResult.errors,
          message: 'Fix the TypeScript errors before testing the API',
        };
      }

      // Step 2: Build the project
      console.log('[Step 2/3: Building clx project...]');
      const buildResult = await buildClx(clxRoot);

      if (!buildResult.success) {
        console.log('[Build failed]');
        state.apiCallsFailed++;
        return {
          success: false,
          phase: 'build',
          errors: buildResult.errors,
          message: 'Fix the build errors before testing the API',
        };
      }

      // Step 3: Execute the API call
      console.log('[Step 3/3: Executing API call...]');
      const result = await executeApiCall({
        clxRoot,
        apiName: state.config.name,
        operationId,
        parameters,
        body,
        auth,
      });

      if (result.success) {
        state.apiCallsSucceeded++;
        console.log(`[API call succeeded: HTTP ${result.status}]`);
      } else {
        state.apiCallsFailed++;
        console.log(`[API call failed: ${result.error}]`);
      }

      return result;
    },
  });
}
