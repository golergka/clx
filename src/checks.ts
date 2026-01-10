// Shared check utilities for install and doctor commands

import * as fs from 'fs';
import * as path from 'path';
import { getUserBinDir, listInstalledApis } from './adapter-loader.js';
import { isInPath } from './setup.js';

export interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  hint?: string;
}

/**
 * Check if bin directory is in PATH
 */
export function checkPath(): CheckResult {
  const binDir = getUserBinDir();

  if (isInPath(binDir)) {
    return {
      name: 'PATH includes ~/.clx/bin',
      status: 'ok',
      message: binDir,
    };
  }

  return {
    name: 'PATH',
    status: 'warn',
    message: `${binDir} not in PATH`,
    hint: `Run 'clx setup' to add it`,
  };
}

/**
 * Check bin directory exists and is writable
 */
export function checkBinDir(): CheckResult {
  const binDir = getUserBinDir();

  try {
    if (!fs.existsSync(binDir)) {
      fs.mkdirSync(binDir, { recursive: true });
    }

    // Check if writable by creating a test file
    const testPath = path.join(binDir, '.writetest');
    fs.writeFileSync(testPath, 'test');
    fs.unlinkSync(testPath);

    return {
      name: 'Bin directory',
      status: 'ok',
      message: `${binDir} (writable)`,
    };
  } catch (err) {
    return {
      name: 'Bin directory',
      status: 'error',
      message: `Not writable: ${binDir}`,
      hint: `Check permissions or set CLX_BIN to a writable directory`,
    };
  }
}

/**
 * Check symlinks are valid
 */
export function checkSymlinks(fix = false): CheckResult {
  const binDir = getUserBinDir();
  const specs = listInstalledApis();

  if (specs.length === 0) {
    return {
      name: 'Symlinks',
      status: 'ok',
      message: 'No symlinks to check',
    };
  }

  const broken: string[] = [];
  const orphaned: string[] = [];

  for (const spec of specs) {
    const symlinkPath = path.join(binDir, spec);

    try {
      if (!fs.existsSync(symlinkPath)) {
        broken.push(spec);
        continue;
      }

      const stats = fs.lstatSync(symlinkPath);
      if (stats.isSymbolicLink()) {
        const target = fs.readlinkSync(symlinkPath);
        // Check if target exists (for real files, not bun virtual paths)
        if (!target.startsWith('/$') && !fs.existsSync(target)) {
          broken.push(spec);
        }
      }
    } catch {
      broken.push(spec);
    }
  }

  // Check for orphaned symlinks (symlinks without specs)
  if (fs.existsSync(binDir)) {
    try {
      const files = fs.readdirSync(binDir);
      for (const file of files) {
        const filePath = path.join(binDir, file);
        const stats = fs.lstatSync(filePath);
        if (stats.isSymbolicLink()) {
          const target = fs.readlinkSync(filePath);
          if (target.includes('clx') && !specs.includes(file) && file !== 'clx') {
            orphaned.push(file);
            if (fix) {
              fs.unlinkSync(filePath);
            }
          }
        }
      }
    } catch {
      // Ignore errors reading bin dir
    }
  }

  if (broken.length > 0) {
    return {
      name: 'Symlinks',
      status: 'warn',
      message: `Missing: ${broken.join(', ')}`,
      hint: `Run 'clx install ${broken[0]}' to fix`,
    };
  }

  if (orphaned.length > 0) {
    if (fix) {
      return {
        name: 'Symlinks',
        status: 'ok',
        message: `Fixed: removed ${orphaned.length} orphaned symlink(s)`,
      };
    }
    return {
      name: 'Symlinks',
      status: 'warn',
      message: `Orphaned: ${orphaned.join(', ')}`,
      hint: `Run 'clx doctor --fix' to remove`,
    };
  }

  return {
    name: 'Symlinks',
    status: 'ok',
    message: `${specs.length} symlink(s) valid`,
  };
}

/**
 * Ensure bin directory exists and is writable
 * Returns true if writable, false otherwise
 */
export function ensureBinDir(): boolean {
  const result = checkBinDir();
  return result.status !== 'error';
}

/**
 * Check if PATH is properly configured
 * Returns true if bin dir is in PATH
 */
export function isPathConfigured(): boolean {
  const result = checkPath();
  return result.status === 'ok';
}

/**
 * Create symlink for an API
 * Returns true if successful
 */
export function createApiSymlink(apiName: string): boolean {
  const binDir = getUserBinDir();
  const symlinkPath = path.join(binDir, apiName);

  // Find the actual clx binary path
  let clxPath = process.argv[1];
  // If running as compiled binary, use that path
  // If running via node/bun, find the actual clx in PATH or use current
  if (clxPath.endsWith('.js') || clxPath.endsWith('.ts')) {
    // Try to find clx in the same bin directory
    const possibleClx = path.join(binDir, 'clx');
    if (fs.existsSync(possibleClx)) {
      clxPath = possibleClx;
    }
  }

  try {
    if (fs.existsSync(symlinkPath)) {
      fs.unlinkSync(symlinkPath);
    }
    fs.symlinkSync(clxPath, symlinkPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove symlink for an API
 * Returns true if successful or didn't exist
 */
export function removeApiSymlink(apiName: string): boolean {
  const binDir = getUserBinDir();
  const symlinkPath = path.join(binDir, apiName);

  try {
    if (fs.existsSync(symlinkPath)) {
      fs.unlinkSync(symlinkPath);
    }
    return true;
  } catch {
    return false;
  }
}
