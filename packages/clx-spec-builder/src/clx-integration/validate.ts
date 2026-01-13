// Validate spec and adapter against clx requirements

import SwaggerParser from '@apidevtools/swagger-parser';
import type { OpenAPI } from 'openapi-types';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { LintResult } from '../types.js';

export async function validateOpenApiSpec(specPath: string): Promise<LintResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    // Parse and validate the spec
    const api = await SwaggerParser.validate(specPath) as OpenAPI.Document;

    // Check for operationIds
    let hasOperationIds = true;
    let missingCount = 0;

    // Cast to get proper typing for paths
    const paths = (api as any).paths || {};
    for (const [pathKey, pathItem] of Object.entries(paths)) {
      for (const [method, operation] of Object.entries(pathItem as Record<string, any>)) {
        if (['get', 'post', 'put', 'patch', 'delete', 'options', 'head'].includes(method)) {
          if (!operation.operationId) {
            hasOperationIds = false;
            missingCount++;
            warnings.push(`Missing operationId for ${method.toUpperCase()} ${pathKey}`);
          }
        }
      }
    }

    if (!hasOperationIds) {
      errors.push(`${missingCount} operations are missing operationIds`);
    }

    // Check for servers (OpenAPI 3.x)
    const servers = (api as any).servers;
    if (!servers || servers.length === 0) {
      errors.push('No servers defined in spec');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  } catch (error) {
    return {
      valid: false,
      errors: [error instanceof Error ? error.message : String(error)],
      warnings,
    };
  }
}

export async function validateAdapter(adapterPath: string): Promise<LintResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    const content = await fs.readFile(adapterPath, 'utf-8');

    // Check for required fields
    if (!content.includes('defineAdapter')) {
      errors.push('Adapter must use defineAdapter()');
    }

    if (!content.includes('name:')) {
      errors.push('Adapter must have a name field');
    }

    // Check for baseUrl (either static or function)
    if (!content.includes('baseUrl:') && !content.includes('baseUrl(')) {
      errors.push('Adapter must have a baseUrl field');
    }

    // Check for common patterns
    if (content.includes('TODO') || content.includes('FIXME')) {
      warnings.push('Adapter contains TODO/FIXME comments');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  } catch (error) {
    return {
      valid: false,
      errors: [error instanceof Error ? error.message : String(error)],
      warnings,
    };
  }
}

export async function validateSpecExists(clxRoot: string, apiName: string): Promise<boolean> {
  const yamlPath = path.join(clxRoot, 'registry', apiName, 'openapi.yaml');
  const jsonPath = path.join(clxRoot, 'registry', apiName, 'openapi.json');

  try {
    await fs.access(yamlPath);
    return true;
  } catch {
    try {
      await fs.access(jsonPath);
      return true;
    } catch {
      return false;
    }
  }
}

export async function validateAdapterExists(clxRoot: string, apiName: string): Promise<boolean> {
  const adapterPath = path.join(clxRoot, 'src', 'specs', `${apiName}.ts`);

  try {
    await fs.access(adapterPath);
    return true;
  } catch {
    return false;
  }
}
