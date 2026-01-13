// Main agent implementation

import { generateText, streamText, type CoreMessage } from 'ai';
import { getModel, validateProviderConfig } from './providers/index.js';
import {
  askUserTool,
  createFileReadTool,
  createFileWriteTool,
  webFetchTool,
  webSearchTool,
  createApiCallTool,
  createLintSpecTool,
  createCompleteTool,
} from './tools/index.js';
import type { SessionConfig, SessionState } from './types.js';
import * as path from 'path';
import * as readline from 'readline';

const SYSTEM_PROMPT = `You are an expert API documentation analyzer and OpenAPI spec generator. Your task is to create a complete, working OpenAPI specification and clx adapter for an API.

## Your Goal
Generate an OpenAPI 3.x spec and TypeScript adapter that allows clx to interact with the target API.

## Process
1. First, explore the API documentation using web_fetch and web_search
2. Study existing clx specs/adapters as examples (read files from registry/ and src/specs/)
3. Create the OpenAPI spec at registry/<apiname>/openapi.yaml
4. Create the adapter at src/specs/<apiname>.ts
5. Update src/specs/index.ts to export the new adapter
6. Use lint_spec to validate your work
7. Use api_call to test at least one endpoint (ask user for credentials first!)
8. Call complete when everything works

## OpenAPI Spec Requirements
- Must be valid OpenAPI 3.x
- Every operation MUST have a unique operationId
- Must include servers array with the API base URL
- Include parameter definitions with types and descriptions
- Include response schemas where documented

## Adapter Requirements
The adapter file should use defineAdapter() and include:
- name: API identifier (lowercase, no spaces)
- displayName: Human-readable name
- baseUrl: API base URL (can be static string or function)
- auth: Authentication configuration (bearer, basic, apiKey, etc.)
- help: Summary and example commands

## Example Adapter Structure
\`\`\`typescript
import { defineAdapter } from '../core/index.js';

export default defineAdapter({
  name: 'apiname',
  displayName: 'API Name',
  baseUrl: 'https://api.example.com',
  auth: {
    type: 'bearer',
    envVar: 'APINAME_TOKEN',
    login: {
      prompt: 'Enter your API token:',
      hint: 'Get your token from https://...',
    },
  },
  help: {
    summary: 'Description of the API',
    examples: [
      { cmd: 'apiname resources list', desc: 'List resources' },
    ],
  },
});
\`\`\`

## Important Notes
- Always ask the user for API credentials before testing endpoints
- If documentation is unclear, search for more sources or ask the user
- Test multiple endpoint types if possible (GET, POST, etc.)
- Keep the spec focused on the most useful endpoints first

## Current Session
API Name: {{API_NAME}}
Display Name: {{DISPLAY_NAME}}
Starting Documentation: {{DOCS_URLS}}
`;

async function promptForConfig(partialConfig: Partial<SessionConfig>): Promise<SessionConfig> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (question: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(question, (answer) => {
        resolve(answer.trim());
      });
    });
  };

  const config: SessionConfig = {
    name: partialConfig.name || '',
    displayName: partialConfig.displayName,
    docsUrls: partialConfig.docsUrls || [],
    provider: partialConfig.provider || 'google',
    clxRoot: partialConfig.clxRoot || process.cwd(),
    outputDir: partialConfig.outputDir || '',
  };

  if (!config.name) {
    config.name = await ask('API name (lowercase, no spaces, e.g., betterstack): ');
  }

  if (!config.displayName) {
    config.displayName = await ask(`Display name (e.g., "Better Stack") [${config.name}]: `) || config.name;
  }

  if (config.docsUrls.length === 0) {
    const urls = await ask('Documentation URL(s) (comma-separated): ');
    config.docsUrls = urls.split(',').map(u => u.trim()).filter(Boolean);
  }

  config.outputDir = path.join(config.clxRoot, 'registry', config.name);

  rl.close();
  return config;
}

export async function runAgent(partialConfig: Partial<SessionConfig>): Promise<void> {
  // Complete config with interactive prompts if needed
  const config = await promptForConfig(partialConfig);

  console.log('\n--- clx-spec-builder ---');
  console.log(`API: ${config.name} (${config.displayName})`);
  console.log(`Provider: ${config.provider}`);
  console.log(`Docs: ${config.docsUrls.join(', ') || '(none)'}`);
  console.log('------------------------\n');

  // Validate provider config
  try {
    validateProviderConfig(config.provider);
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }

  // Initialize session state
  const state: SessionState = {
    config,
    apiCallsSucceeded: 0,
    apiCallsFailed: 0,
    specPath: null,
    adapterPath: null,
  };

  // Build system prompt
  const systemPrompt = SYSTEM_PROMPT
    .replace('{{API_NAME}}', config.name)
    .replace('{{DISPLAY_NAME}}', config.displayName || config.name)
    .replace('{{DOCS_URLS}}', config.docsUrls.join(', ') || '(none provided)');

  // Create tools
  const allowedDirs = [
    path.join('registry', config.name),
    path.join('src', 'specs'),
  ];

  const tools = {
    ask_user: askUserTool,
    read_file: createFileReadTool(config.clxRoot),
    write_file: createFileWriteTool(config.clxRoot, allowedDirs),
    web_fetch: webFetchTool,
    web_search: webSearchTool,
    api_call: createApiCallTool(config.clxRoot, state),
    lint_spec: createLintSpecTool(config.clxRoot),
    complete: createCompleteTool(config.clxRoot, state),
  };

  // Get model
  const model = getModel(config.provider);

  // Conversation history
  const messages: CoreMessage[] = [
    {
      role: 'user',
      content: `Please generate an OpenAPI spec and adapter for the ${config.displayName || config.name} API. ${
        config.docsUrls.length > 0
          ? `Start by reading the documentation at: ${config.docsUrls.join(', ')}`
          : 'Start by searching for the API documentation.'
      }`,
    },
  ];

  console.log('[Starting agent...]\n');

  // Main agent loop
  let maxIterations = 100;
  let iteration = 0;

  while (iteration < maxIterations) {
    iteration++;

    try {
      const result = await generateText({
        model,
        system: systemPrompt,
        messages,
        tools,
        maxSteps: 10,
        onStepFinish: async (step) => {
          // Log tool usage
          if (step.toolCalls && step.toolCalls.length > 0) {
            for (const call of step.toolCalls) {
              console.log(`[Tool: ${call.toolName}]`);
            }
          }

          // Log text output
          if (step.text) {
            console.log(`\n${step.text}\n`);
          }
        },
      });

      // Add assistant response to history
      messages.push({
        role: 'assistant',
        content: result.text || '[No text response]',
      });

      // Check if complete tool was called successfully
      const completeCall = result.toolCalls?.find(c => c.toolName === 'complete');
      if (completeCall) {
        const completeResult = result.toolResults?.find(r => r.toolCallId === completeCall.toolCallId);
        if (completeResult?.result && (completeResult.result as any).passed) {
          console.log('\n=== Generation Complete ===');
          console.log(`Spec: ${(completeResult.result as any).files.spec}`);
          console.log(`Adapter: ${(completeResult.result as any).files.adapter}`);
          console.log(`API calls: ${state.apiCallsSucceeded} succeeded, ${state.apiCallsFailed} failed`);
          return;
        }
      }

      // Check if agent has more to do
      if (result.finishReason === 'stop' && !result.toolCalls?.length) {
        // Agent stopped without calling tools - might need user input
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const userInput = await new Promise<string>((resolve) => {
          rl.question('\n> ', (answer) => {
            rl.close();
            resolve(answer.trim());
          });
        });

        if (userInput.toLowerCase() === 'quit' || userInput.toLowerCase() === 'exit') {
          console.log('\n[Exiting...]');
          return;
        }

        messages.push({
          role: 'user',
          content: userInput,
        });
      }
    } catch (error) {
      console.error(`\n[Error: ${error instanceof Error ? error.message : error}]\n`);

      // Add error to conversation so agent can recover
      messages.push({
        role: 'user',
        content: `An error occurred: ${error instanceof Error ? error.message : error}. Please try a different approach.`,
      });
    }
  }

  console.log('\n[Max iterations reached. Exiting.]');
}
