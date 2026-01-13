// file_write tool - write/edit spec and adapter files

import { tool } from 'ai';
import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';

export function createFileWriteTool(clxRoot: string, allowedDirs: string[]) {
  return tool({
    description: `Write or overwrite a file. You can write to:
- registry/<api>/openapi.yaml - OpenAPI spec
- registry/<api>/.source.yaml - Spec metadata
- src/specs/<api>.ts - Adapter configuration
Allowed directories: ${allowedDirs.join(', ')}`,
    parameters: z.object({
      filePath: z.string().describe('Path to the file (relative to clx root or absolute)'),
      content: z.string().describe('Content to write to the file'),
    }),
    execute: async ({ filePath, content }) => {
      try {
        const fullPath = path.isAbsolute(filePath)
          ? filePath
          : path.join(clxRoot, filePath);

        // Security: check if path is within allowed directories
        const isAllowed = allowedDirs.some(dir => {
          const allowedPath = path.isAbsolute(dir) ? dir : path.join(clxRoot, dir);
          return fullPath.startsWith(allowedPath);
        });

        if (!isAllowed) {
          return {
            success: false,
            error: `Path not allowed. Can only write to: ${allowedDirs.join(', ')}`,
          };
        }

        // Create directory if needed
        await fs.mkdir(path.dirname(fullPath), { recursive: true });

        await fs.writeFile(fullPath, content, 'utf-8');
        return {
          success: true,
          path: fullPath,
          bytesWritten: content.length,
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
