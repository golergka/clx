// Main agent implementation

import { generateText, type CoreMessage } from 'ai';
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
import type { SessionConfig, SessionState, UsageStats } from './types.js';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as readline from 'readline';

const SYSTEM_PROMPT_NEW = `You are an expert API documentation analyzer and OpenAPI spec generator. Your task is to create a complete, working OpenAPI specification and clx adapter for an API.

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

Optional but recommended (read existing adapters like src/specs/stripe.ts for examples):
- pagination: Configure cursor/offset pagination if API supports it
- errors: Custom error extraction from API responses
- rateLimit: Rate limit headers and retry configuration
- request.headers: Custom headers (API version, etc.)

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

const SYSTEM_PROMPT_MODIFY = `You are an expert API documentation analyzer and OpenAPI spec generator. Your task is to modify and improve an existing OpenAPI specification and clx adapter.

## Your Goal
Improve the existing OpenAPI 3.x spec and TypeScript adapter for the {{API_NAME}} API.

## Existing Files
- OpenAPI spec: registry/{{API_NAME}}/openapi.yaml
- Adapter: src/specs/{{API_NAME}}.ts

## Process
1. First, read the existing spec and adapter to understand what's already implemented
2. Explore the API documentation to find additional endpoints or improvements
3. Modify the OpenAPI spec to add new endpoints or fix issues
4. Update the adapter if needed (auth, pagination, error handling, etc.)
5. Use lint_spec to validate your work
6. Use api_call to test endpoints (ask user for credentials first!)
7. Call complete when everything works

## Guidelines
- Preserve existing working endpoints unless explicitly asked to change them
- Add new endpoints incrementally
- Update the adapter's help examples if you add significant new functionality
- Test both existing and new endpoints if possible

## Current Session
API Name: {{API_NAME}}
Display Name: {{DISPLAY_NAME}}
Documentation: {{DOCS_URLS}}
Mode: MODIFY EXISTING
`;

async function checkExistingFiles(clxRoot: string, apiName: string): Promise<{ specExists: boolean; adapterExists: boolean }> {
  const specPath = path.join(clxRoot, 'registry', apiName, 'openapi.yaml');
  const adapterPath = path.join(clxRoot, 'src', 'specs', `${apiName}.ts`);

  let specExists = false;
  let adapterExists = false;

  try {
    await fs.access(specPath);
    specExists = true;
  } catch {}

  try {
    await fs.access(adapterPath);
    adapterExists = true;
  } catch {}

  return { specExists, adapterExists };
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${seconds}s`;
}

// Pricing per 1M tokens (as of Jan 2025)
const PRICING: Record<string, { input: number; output: number }> = {
  google: { input: 0.075, output: 0.30 },      // Gemini 2.0 Flash
  anthropic: { input: 3.00, output: 15.00 },   // Claude Sonnet
  openai: { input: 2.50, output: 10.00 },      // GPT-4o
};

function calculateCost(provider: string, promptTokens: number, completionTokens: number): number {
  const pricing = PRICING[provider] || PRICING.openai;
  const inputCost = (promptTokens / 1_000_000) * pricing.input;
  const outputCost = (completionTokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

function printUsageSummary(state: SessionState): void {
  const usage = state.usage;
  usage.endTime = Date.now();
  const duration = usage.endTime - usage.startTime;
  const cost = calculateCost(state.config.provider, usage.promptTokens, usage.completionTokens);

  console.log('\n' + '='.repeat(50));
  console.log('SESSION SUMMARY');
  console.log('='.repeat(50));
  console.log(`Duration: ${formatDuration(duration)}`);
  console.log(`Iterations: ${usage.iterations}`);
  console.log(`Mode: ${state.existingSpec || state.existingAdapter ? 'Modify existing' : 'Create new'}`);
  console.log('');
  console.log('API Calls:');
  console.log(`  Succeeded: ${state.apiCallsSucceeded}`);
  console.log(`  Failed: ${state.apiCallsFailed}`);
  console.log('');
  console.log('Tool Usage:');
  const sortedTools = Object.entries(usage.toolCalls).sort((a, b) => b[1] - a[1]);
  for (const [tool, count] of sortedTools) {
    console.log(`  ${tool}: ${count}`);
  }
  console.log(`  Total: ${usage.totalToolCalls}`);
  console.log('');
  console.log('Tokens:');
  console.log(`  Prompt: ${usage.promptTokens.toLocaleString()}`);
  console.log(`  Completion: ${usage.completionTokens.toLocaleString()}`);
  console.log(`  Total: ${usage.totalTokens.toLocaleString()}`);
  console.log('');
  console.log(`Estimated Cost: $${cost.toFixed(4)} (${state.config.provider})`);
  console.log('='.repeat(50));
}

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

  // Check for existing files
  const { specExists, adapterExists } = await checkExistingFiles(config.clxRoot, config.name);

  console.log('\n--- clx-spec-builder ---');
  console.log(`API: ${config.name} (${config.displayName})`);
  console.log(`Provider: ${config.provider}`);
  console.log(`Docs: ${config.docsUrls.join(', ') || '(none)'}`);
  console.log(`Mode: ${specExists || adapterExists ? 'MODIFY EXISTING' : 'CREATE NEW'}`);
  if (specExists) console.log(`  - Existing spec found`);
  if (adapterExists) console.log(`  - Existing adapter found`);
  console.log('------------------------\n');

  // Validate provider config
  try {
    validateProviderConfig(config.provider);
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }

  // Initialize usage stats
  const usage: UsageStats = {
    startTime: Date.now(),
    iterations: 0,
    toolCalls: {},
    totalToolCalls: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };

  // Initialize session state
  const state: SessionState = {
    config,
    apiCallsSucceeded: 0,
    apiCallsFailed: 0,
    specPath: null,
    adapterPath: null,
    existingSpec: specExists,
    existingAdapter: adapterExists,
    usage,
  };

  // Build system prompt based on mode
  const basePrompt = (specExists || adapterExists) ? SYSTEM_PROMPT_MODIFY : SYSTEM_PROMPT_NEW;
  const systemPrompt = basePrompt
    .replace(/\{\{API_NAME\}\}/g, config.name)
    .replace(/\{\{DISPLAY_NAME\}\}/g, config.displayName || config.name)
    .replace(/\{\{DOCS_URLS\}\}/g, config.docsUrls.join(', ') || '(none provided)');

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

  // Build initial message based on mode
  let initialMessage: string;
  if (specExists || adapterExists) {
    initialMessage = `Please review and improve the existing OpenAPI spec and adapter for the ${config.displayName || config.name} API. ${
      config.docsUrls.length > 0
        ? `Use the documentation at: ${config.docsUrls.join(', ')} to add more endpoints or fix any issues.`
        : 'Search for documentation to find additional endpoints to add.'
    }`;
  } else {
    initialMessage = `Please generate an OpenAPI spec and adapter for the ${config.displayName || config.name} API. ${
      config.docsUrls.length > 0
        ? `Start by reading the documentation at: ${config.docsUrls.join(', ')}`
        : 'Start by searching for the API documentation.'
    }`;
  }

  // Conversation history
  const messages: CoreMessage[] = [
    {
      role: 'user',
      content: initialMessage,
    },
  ];

  console.log('[Starting agent...]\n');

  // Main agent loop
  let maxIterations = 100;

  while (usage.iterations < maxIterations) {
    usage.iterations++;

    try {
      const result = await generateText({
        model,
        system: systemPrompt,
        messages,
        tools,
        maxSteps: 10,
        onStepFinish: async (step) => {
          // Track tool usage
          if (step.toolCalls && step.toolCalls.length > 0) {
            for (const call of step.toolCalls) {
              console.log(`[Tool: ${call.toolName}]`);
              usage.toolCalls[call.toolName] = (usage.toolCalls[call.toolName] || 0) + 1;
              usage.totalToolCalls++;
            }
          }

          // Log text output
          if (step.text) {
            console.log(`\n${step.text}\n`);
          }

          // Track token usage from step
          if (step.usage) {
            usage.promptTokens += step.usage.promptTokens || 0;
            usage.completionTokens += step.usage.completionTokens || 0;
            usage.totalTokens += (step.usage.promptTokens || 0) + (step.usage.completionTokens || 0);
          }
        },
      });

      // Track final token usage
      if (result.usage) {
        // Only add if not already tracked in steps
        if (!result.steps || result.steps.length === 0) {
          usage.promptTokens += result.usage.promptTokens || 0;
          usage.completionTokens += result.usage.completionTokens || 0;
          usage.totalTokens += result.usage.totalTokens || 0;
        }
      }

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
          printUsageSummary(state);
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
          printUsageSummary(state);
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
  printUsageSummary(state);
}
