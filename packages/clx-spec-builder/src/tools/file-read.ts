// file_read tool - read files including example specs

import { tool } from 'ai';
import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';

export function createFileReadTool(clxRoot: string) {
  return tool({
    description: `Read a file from the filesystem. You can read:
- Example OpenAPI specs from registry/<api>/openapi.yaml
- Example adapters from src/specs/<api>.ts
- Any other file in the clx project
The clxRoot is: ${clxRoot}`,
    parameters: z.object({
      filePath: z.string().describe('Path to the file (relative to clx root or absolute)'),
    }),
    execute: async ({ filePath }) => {
      try {
        const fullPath = path.isAbsolute(filePath)
          ? filePath
          : path.join(clxRoot, filePath);

        const content = await fs.readFile(fullPath, 'utf-8');
        return {
          success: true,
          path: fullPath,
          content,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });
}
