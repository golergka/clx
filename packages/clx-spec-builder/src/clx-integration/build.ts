// Build clx project and capture errors

import { spawn } from 'child_process';
import * as path from 'path';

export interface BuildResult {
  success: boolean;
  errors: string[];
  output: string;
}

export async function buildClx(clxRoot: string): Promise<BuildResult> {
  return new Promise((resolve) => {
    const proc = spawn('bun', ['run', 'build'], {
      cwd: clxRoot,
      shell: true,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      const output = stdout + stderr;
      const errors: string[] = [];

      // Parse TypeScript errors
      const errorMatches = output.matchAll(/error TS\d+: ([^\n]+)/g);
      for (const match of errorMatches) {
        errors.push(match[1]);
      }

      // Also check for generic errors
      if (code !== 0 && errors.length === 0) {
        errors.push(output.trim() || 'Build failed with unknown error');
      }

      resolve({
        success: code === 0,
        errors,
        output,
      });
    });

    proc.on('error', (err) => {
      resolve({
        success: false,
        errors: [err.message],
        output: '',
      });
    });
  });
}

export async function typecheckClx(clxRoot: string): Promise<BuildResult> {
  return new Promise((resolve) => {
    const proc = spawn('bun', ['run', 'typecheck'], {
      cwd: clxRoot,
      shell: true,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      const output = stdout + stderr;
      const errors: string[] = [];

      // Parse TypeScript errors
      const errorMatches = output.matchAll(/error TS\d+: ([^\n]+)/g);
      for (const match of errorMatches) {
        errors.push(match[1]);
      }

      // Also parse file:line errors
      const fileErrors = output.matchAll(/(\S+\.ts)\((\d+),(\d+)\): error TS\d+: ([^\n]+)/g);
      for (const match of fileErrors) {
        errors.push(`${match[1]}:${match[2]} - ${match[4]}`);
      }

      if (code !== 0 && errors.length === 0 && output.trim()) {
        errors.push(output.trim());
      }

      resolve({
        success: code === 0,
        errors,
        output,
      });
    });

    proc.on('error', (err) => {
      resolve({
        success: false,
        errors: [err.message],
        output: '',
      });
    });
  });
}
