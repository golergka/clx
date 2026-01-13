// Execute API calls through clx adapter system

import * as path from 'path';
import * as fs from 'fs/promises';
import { parse as parseYaml } from 'yaml';
import type { ApiCallResult } from '../types.js';

interface ExecuteOptions {
  clxRoot: string;
  apiName: string;
  operationId: string;
  parameters: Record<string, string>;
  body?: unknown;
  auth?: {
    token?: string;
    username?: string;
    password?: string;
  };
}

/**
 * Execute an API call through the clx code path.
 *
 * This dynamically loads the spec and adapter, then calls the API
 * the same way clx would in production.
 */
export async function executeApiCall(options: ExecuteOptions): Promise<ApiCallResult> {
  const { clxRoot, apiName, operationId, parameters, body, auth } = options;

  try {
    // Load the OpenAPI spec
    const specPath = path.join(clxRoot, 'registry', apiName, 'openapi.yaml');
    let specContent: string;

    try {
      specContent = await fs.readFile(specPath, 'utf-8');
    } catch {
      // Try JSON
      const jsonPath = path.join(clxRoot, 'registry', apiName, 'openapi.json');
      specContent = await fs.readFile(jsonPath, 'utf-8');
    }

    const spec = specPath.endsWith('.yaml') || specPath.endsWith('.yml')
      ? parseYaml(specContent)
      : JSON.parse(specContent);

    // Find the operation in the spec
    let operation: any = null;
    let operationPath = '';
    let operationMethod = '';

    for (const [pathKey, pathItem] of Object.entries(spec.paths || {})) {
      for (const [method, op] of Object.entries(pathItem as Record<string, any>)) {
        if (['get', 'post', 'put', 'patch', 'delete'].includes(method) && op.operationId === operationId) {
          operation = op;
          operationPath = pathKey;
          operationMethod = method.toUpperCase();
          break;
        }
      }
      if (operation) break;
    }

    if (!operation) {
      return {
        success: false,
        error: `Operation '${operationId}' not found in spec`,
      };
    }

    // Build the URL
    const servers = spec.servers || [];
    const baseUrl = servers[0]?.url || '';
    let url = baseUrl + operationPath;

    // Substitute path parameters
    for (const [key, value] of Object.entries(parameters)) {
      url = url.replace(`{${key}}`, encodeURIComponent(value));
    }

    // Add query parameters
    const queryParams: string[] = [];
    for (const param of operation.parameters || []) {
      if (param.in === 'query' && parameters[param.name]) {
        queryParams.push(`${param.name}=${encodeURIComponent(parameters[param.name])}`);
      }
    }
    if (queryParams.length > 0) {
      url += '?' + queryParams.join('&');
    }

    // Build headers
    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };

    if (body) {
      headers['Content-Type'] = 'application/json';
    }

    // Apply auth
    if (auth?.token) {
      headers['Authorization'] = `Bearer ${auth.token}`;
    } else if (auth?.username && auth?.password) {
      const credentials = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
      headers['Authorization'] = `Basic ${credentials}`;
    }

    // Execute the request
    console.log(`[API Call: ${operationMethod} ${url}]`);

    const response = await fetch(url, {
      method: operationMethod,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    let data: unknown;
    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    return {
      success: response.ok,
      status: response.status,
      data,
      error: response.ok ? undefined : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
