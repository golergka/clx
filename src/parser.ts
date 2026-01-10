import type { OpenAPISpec, CommandNode, OperationInfo, Parameter, Operation } from './types.js';

// Convert HTTP method name to a user-friendly command name
function methodToCommand(method: string): string {
  const mapping: Record<string, string> = {
    get: 'get',
    post: 'create',
    put: 'update',
    patch: 'update',
    delete: 'delete',
  };
  return mapping[method] || method;
}

// Normalize operationId to detect patterns
function normalizeOperationId(operationId: string): string {
  return operationId
    .replace(/([a-z])([A-Z])/g, '$1 $2')  // camelCase: GetCustomers -> Get Customers
    .replace(/[/_-]/g, ' ')                // separators: meta/get-zen -> meta get zen
    .toLowerCase()
    .trim();
}

// Check if path ends with a parameter (e.g., /customers/{id})
function hasIdParameter(pathSegments?: string[]): boolean {
  if (!pathSegments || pathSegments.length === 0) return false;
  const lastSegment = pathSegments[pathSegments.length - 1];
  return lastSegment.startsWith('{');
}

// Check if operation returns an array (collection) vs single value
function doesOperationReturnArray(operation?: Operation): boolean {
  if (!operation?.responses) return false;

  // Check 200 or 201 response
  const successResponse = operation.responses['200'] || operation.responses['201'];
  if (!successResponse) return false;

  // Get content schema
  const content = successResponse.content;
  if (!content) return false;

  const jsonContent = content['application/json'];
  if (!jsonContent?.schema) return false;

  const schema = jsonContent.schema;

  // Check if schema is array type
  if (schema.type === 'array') return true;
  if (schema.items !== undefined) return true;

  // Check for common list response patterns (data array wrapper)
  if (schema.properties?.data?.type === 'array') return true;
  if (schema.properties?.items?.type === 'array') return true;
  if (schema.properties?.results?.type === 'array') return true;

  return false;
}

// Infer a better command name from operationId or path
function inferCommandName(method: string, operationId?: string, pathSegments?: string[], operation?: Operation): string {
  const hasId = hasIdParameter(pathSegments);
  const returnsArray = doesOperationReturnArray(operation);

  if (operationId) {
    const normalized = normalizeOperationId(operationId);

    // Explicit action patterns (list, create, etc.)
    if (/\b(list|get-?all|find-?all|search)\b/i.test(normalized)) {
      return 'list';
    }
    if (/\b(create|add|new)\b/i.test(normalized) && !hasId) {
      return 'create';
    }
    if (/\b(update|modify|edit|patch|put)\b/i.test(normalized)) {
      return 'update';
    }
    if (/\b(delete|remove|destroy)\b/i.test(normalized)) {
      return 'delete';
    }
    if (/\b(retrieve|fetch)\b/i.test(normalized)) {
      return 'get';
    }

    // Handle operationIds that start with HTTP method (e.g., "GetUsers", "PostOrders")
    // Use path structure to determine the actual action
    const httpMethodMatch = normalized.match(/^(get|post|put|patch|delete)\s+(.+)/);
    if (httpMethodMatch) {
      const httpMethod = httpMethodMatch[1];
      // Use path structure to determine action
      if (hasId) {
        // Has ID param - get, update, or delete
        if (httpMethod === 'get') return 'get';
        if (httpMethod === 'post' || httpMethod === 'put' || httpMethod === 'patch') return 'update';
        if (httpMethod === 'delete') return 'delete';
      } else {
        // Collection endpoint - check if returns array
        if (httpMethod === 'get') return returnsArray ? 'list' : 'get';
        if (httpMethod === 'post') return 'create';
      }
    }

    // Handle patterns like "get" alone (for single-value endpoints)
    if (normalized === 'get' || /^get\s*$/.test(normalized)) {
      return 'get';  // Single-value endpoint
    }
  }

  // Fallback: use HTTP method + path structure + response schema
  if (pathSegments && pathSegments.length > 0) {
    if (hasId) {
      // Path has an ID parameter
      if (method === 'get') return 'get';
      if (method === 'put' || method === 'patch') return 'update';
      if (method === 'post') return 'update';  // POST with ID is often update
      if (method === 'delete') return 'delete';
    } else {
      // Collection endpoint - check response schema
      if (method === 'get') return returnsArray ? 'list' : 'get';
      if (method === 'post') return 'create';
    }
  }

  return methodToCommand(method);
}

// Parse path segments, separating static parts from parameters
function parsePathSegments(path: string): string[] {
  return path.split('/').filter(s => s.length > 0);
}

// Get resource name from path segment (e.g., "customers" from "/v1/customers/{id}")
function getResourceName(segment: string): string {
  // Remove version prefixes like v1, v2, etc.
  if (/^v\d+$/.test(segment)) {
    return '';
  }
  // Remove curly braces for path parameters
  if (segment.startsWith('{') && segment.endsWith('}')) {
    return '';
  }
  return segment;
}

// Build command tree from OpenAPI paths
export function buildCommandTree(spec: OpenAPISpec): CommandNode {
  const root: CommandNode = {
    name: spec.info.title,
    description: spec.info.description,
    children: new Map(),
    operations: new Map(),
  };

  for (const [path, pathItem] of Object.entries(spec.paths)) {
    if (!pathItem) continue;

    const segments = parsePathSegments(path);

    // Resolve path-level parameter refs
    const pathParameters: Parameter[] = (pathItem.parameters || []).map(param => {
      if ('$ref' in param && param.$ref) {
        const resolved = resolveRef<Parameter>(spec, param.$ref);
        return resolved || param as Parameter;
      }
      return param as Parameter;
    });

    // Process each HTTP method
    const methods = ['get', 'post', 'put', 'patch', 'delete'] as const;

    for (const method of methods) {
      const operation = pathItem[method];
      if (!operation) continue;

      // Build the path to this operation in the command tree
      let current = root;
      const resourcePath: string[] = [];

      for (const segment of segments) {
        const resourceName = getResourceName(segment);
        if (!resourceName) continue;

        resourcePath.push(resourceName);

        if (!current.children.has(resourceName)) {
          current.children.set(resourceName, {
            name: resourceName,
            description: undefined,
            children: new Map(),
            operations: new Map(),
          });
        }
        current = current.children.get(resourceName)!;
      }

      // Determine command name for this operation
      const commandName = inferCommandName(method, operation.operationId, segments, operation);

      // Resolve operation-level parameter refs and merge with path-level
      const operationParams: Parameter[] = (operation.parameters || []).map(param => {
        if ('$ref' in param && param.$ref) {
          const resolved = resolveRef<Parameter>(spec, param.$ref);
          return resolved || param as Parameter;
        }
        return param as Parameter;
      });

      // Collect all parameters (path-level + operation-level)
      const allParams: Parameter[] = [
        ...pathParameters,
        ...operationParams,
      ];

      // Filter to get path parameters only
      const pathParams = allParams.filter(p => p.in === 'path');

      const opInfo: OperationInfo = {
        method,
        path,
        operation,
        pathParameters: pathParams,
        resolvedParameters: allParams,
      };

      // If we're at root and no resource was found, add to root operations
      if (current === root && resourcePath.length === 0) {
        current.operations.set(commandName, opInfo);
      } else {
        current.operations.set(commandName, opInfo);
      }

      // Update description from operation if not set
      if (!current.description && operation.summary) {
        current.description = operation.summary;
      }
    }
  }

  return root;
}

// Resolve $ref references in the spec
export function resolveRef<T>(spec: OpenAPISpec, ref: string): T | null {
  // Format: #/components/schemas/Customer
  if (!ref.startsWith('#/')) {
    return null;
  }

  const parts = ref.substring(2).split('/');
  let current: unknown = spec;

  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return null;
    }
  }

  return current as T;
}

// Validate if a string is a valid URL
function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

// Get the base URL from the spec
export function getBaseUrl(spec: OpenAPISpec, defaultHost?: string): string {
  // If override provided, use it
  if (defaultHost) {
    // Remove trailing slash
    return defaultHost.replace(/\/$/, '');
  }

  if (spec.servers && spec.servers.length > 0) {
    let url = spec.servers[0].url;

    // Resolve server variables (e.g., {basePath}, {version})
    const variables = spec.servers[0].variables;
    if (variables) {
      for (const [key, variable] of Object.entries(variables)) {
        const value = variable.default || (variable.enum ? variable.enum[0] : '');
        url = url.replace(`{${key}}`, value);
      }
    }

    // Handle relative URLs
    if (url.startsWith('/')) {
      // Relative URL needs a base - return empty to trigger error
      return '';
    }

    // Validate URL format
    if (!isValidUrl(url)) {
      // Invalid URL - return empty to trigger error
      return '';
    }

    // Remove trailing slash
    return url.replace(/\/$/, '');
  }

  return '';
}

// Get security requirements for an operation
export function getSecurityRequirements(spec: OpenAPISpec, operation: Operation): Record<string, string[]>[] {
  // Operation-level security overrides spec-level
  if (operation.security !== undefined) {
    return operation.security;
  }

  return spec.security || [];
}
