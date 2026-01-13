#!/usr/bin/env node

import { Command } from 'commander';
import { runAgent } from './agent.js';
import type { SessionConfig } from './types.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const program = new Command();

program
  .name('clx-spec-builder')
  .description('AI-powered OpenAPI spec generator for clx')
  .version('0.1.0')
  .option('-n, --name <name>', 'API name (e.g., betterstack)')
  .option('-d, --display-name <displayName>', 'Display name (e.g., "Better Stack")')
  .option('--docs <urls...>', 'Documentation URLs to start with')
  .option('-p, --provider <provider>', 'LLM provider (google, anthropic, openai)', 'google')
  .option('--clx-root <path>', 'Path to clx project root', path.resolve(__dirname, '../../../'))
  .action(async (options) => {
    // Build config from options or run in interactive mode
    const config: Partial<SessionConfig> = {
      name: options.name,
      displayName: options.displayName,
      docsUrls: options.docs || [],
      provider: options.provider as 'google' | 'anthropic' | 'openai',
      clxRoot: options.clxRoot,
    };

    // Calculate output directory
    if (config.name) {
      config.outputDir = path.join(config.clxRoot!, 'registry', config.name);
    }

    await runAgent(config as SessionConfig);
  });

program.parse();
