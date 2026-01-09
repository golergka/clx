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

// Infer a better command name from operationId or path
function inferCommandName(method: string, operationId?: string, pathSegments?: string[]): string {
  if (operationId) {
    // Common patterns: getCustomer, createCustomer, listCustomers, deleteCustomer
    const lower = operationId.toLowerCase();
    if (lower.startsWith('list') || lower.startsWith('getall') || lower.endsWith('list')) {
      return 'list';
    }
    if (lower.startsWith('get') || lower.startsWith('retrieve') || lower.startsWith('fetch')) {
      return 'get';
    }
    if (lower.startsWith('create') || lower.startsWith('add') || lower.startsWith('new')) {
      return 'create';
    }
    if (lower.startsWith('update') || lower.startsWith('modify') || lower.startsWith('edit') || lower.startsWith('patch')) {
      return 'update';
    }
    if (lower.startsWith('delete') || lower.startsWith('remove') || lower.startsWith('destroy')) {
      return 'delete';
    }
  }

  // Check if path ends with a parameter (e.g., /customers/{id})
  if (pathSegments && pathSegments.length > 0) {
    const lastSegment = pathSegments[pathSegments.length - 1];
    if (lastSegment.startsWith('{')) {
      // Path has an ID parameter
      if (method === 'get') return 'get';
      if (method === 'put' || method === 'patch') return 'update';
      if (method === 'delete') return 'delete';
    } else {
      // Path is a collection endpoint
      if (method === 'get') return 'list';
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
    const pathParameters = pathItem.parameters || [];

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
      const commandName = inferCommandName(method, operation.operationId, segments);

      // Collect all parameters (path-level + operation-level)
      const allParams: Parameter[] = [
        ...pathParameters,
        ...(operation.parameters || []),
      ];

      // Filter to get path parameters only
      const pathParams = allParams.filter(p => p.in === 'path');

      const opInfo: OperationInfo = {
        method,
        path,
        operation,
        pathParameters: pathParams,
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

// Get the base URL from the spec
export function getBaseUrl(spec: OpenAPISpec, defaultHost?: string): string {
  if (spec.servers && spec.servers.length > 0) {
    let url = spec.servers[0].url;

    // Resolve server variables
    const variables = spec.servers[0].variables;
    if (variables) {
      for (const [key, value] of Object.entries(variables)) {
        url = url.replace(`{${key}}`, value.default);
      }
    }

    // Handle relative URLs
    if (url.startsWith('/')) {
      // If we have a default host (from config or registry), use it
      if (defaultHost) {
        return defaultHost + url;
      }
      // Otherwise, try to infer from common patterns
      // This is a fallback for specs that don't include full URLs
      return url;
    }

    return url;
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
