import type { CommandNode, OperationInfo, Parameter, OpenAPISpec, Schema } from './types.js';
import { resolveRef } from './parser.js';

// Generate help text for root level (list all resource groups)
// Kept concise for agent-friendliness (<50 tokens)
export function generateRootHelp(apiName: string, root: CommandNode): string {
  const lines: string[] = [];

  lines.push(`${apiName} - ${root.description || root.name || 'API client'}`);
  lines.push('');
  lines.push('Commands:');

  // List all child resources (sorted)
  const children = Array.from(root.children.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  for (const [name, child] of children) {
    const desc = truncateDesc(child.description || `Manage ${name}`);
    lines.push(`  ${name.padEnd(20)} ${desc}`);
  }

  // List root-level operations if any
  if (root.operations.size > 0) {
    for (const [name, op] of root.operations.entries()) {
      const desc = truncateDesc(op.operation.summary || '');
      lines.push(`  ${name.padEnd(20)} ${desc}`);
    }
  }

  lines.push('');
  lines.push(`Run '${apiName} <command> --help' for details.`);

  return lines.join('\n');
}

// Generate help text for a resource (list operations)
export function generateResourceHelp(apiName: string, resourcePath: string[], node: CommandNode): string {
  const lines: string[] = [];
  const fullCommand = [apiName, ...resourcePath].join(' ');

  lines.push(`${fullCommand} - ${node.description || `Manage ${resourcePath[resourcePath.length - 1]}`}`);
  lines.push('');

  // List child resources
  if (node.children.size > 0) {
    lines.push('Commands:');
    const children = Array.from(node.children.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    for (const [name, child] of children) {
      const desc = truncateDesc(child.description || `Manage ${name}`);
      lines.push(`  ${name.padEnd(20)} ${desc}`);
    }
  }

  // List operations
  if (node.operations.size > 0) {
    if (node.children.size > 0) lines.push('');
    lines.push('Operations:');
    const ops = Array.from(node.operations.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    for (const [name, op] of ops) {
      const desc = truncateDesc(op.operation.summary || '');
      lines.push(`  ${name.padEnd(20)} ${desc}`);
    }
  }

  lines.push('');
  lines.push(`Run '${fullCommand} <command> --help' for details.`);

  return lines.join('\n');
}

// Generate help text for an operation (<100 tokens for agent efficiency)
export function generateOperationHelp(
  apiName: string,
  resourcePath: string[],
  opName: string,
  opInfo: OperationInfo,
  spec: OpenAPISpec
): string {
  const lines: string[] = [];
  const fullCommand = [apiName, ...resourcePath, opName].join(' ');

  // Summary line
  lines.push(`${fullCommand} - ${opInfo.operation.summary || opInfo.method.toUpperCase()}`);
  lines.push('');

  // Use pre-resolved parameters from parser (refs already resolved)
  const allParams = opInfo.resolvedParameters || opInfo.pathParameters || [];

  // Path parameters (required for the command)
  const pathParams = allParams.filter(p => p.in === 'path');
  if (pathParams.length > 0) {
    lines.push('Arguments:');
    for (const param of pathParams) {
      const schemaInfo = formatSchemaType(param.schema);
      lines.push(`  --${param.name} ${schemaInfo}  ${param.required ? '(required)' : ''}`);
    }
    lines.push('');
  }

  // Query parameters
  const queryParams = allParams.filter(p => p.in === 'query');
  if (queryParams.length > 0) {
    lines.push('Options:');
    // Show first 10 most important parameters
    const sortedParams = queryParams.sort((a, b) => {
      if (a.required && !b.required) return -1;
      if (!a.required && b.required) return 1;
      return 0;
    });
    const displayParams = sortedParams.slice(0, 10);
    for (const param of displayParams) {
      const schemaInfo = formatSchemaType(param.schema);
      const req = param.required ? ' (required)' : '';
      lines.push(`  --${param.name}${req}  ${schemaInfo}`);
    }
    if (queryParams.length > 10) {
      lines.push(`  ... and ${queryParams.length - 10} more options`);
    }
    lines.push('');
  }

  // Request body (simplified)
  const requestBody = opInfo.operation.requestBody;
  if (requestBody) {
    lines.push('Body:');
    lines.push(`  Use --data='{"key":"value"}' or pipe JSON via stdin`);
    lines.push('');
  }

  // Examples
  lines.push('Examples:');
  lines.push(`  ${fullCommand}${pathParams.length > 0 ? ` --${pathParams[0].name}=<value>` : ''}`);
  if (opInfo.method !== 'get') {
    lines.push(`  ${fullCommand} --data='{"key":"value"}'`);
  }

  return lines.join('\n');
}

// Truncate description to keep help concise
function truncateDesc(desc: string, maxLen: number = 40): string {
  if (!desc) return '';
  // Remove newlines and extra spaces
  const cleaned = desc.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.substring(0, maxLen - 3) + '...';
}

function formatSchemaType(schema?: Schema): string {
  if (!schema) return '';

  if (schema.enum) {
    const values = schema.enum.slice(0, 3).join('|');
    return schema.enum.length > 3 ? `[${values}|...]` : `[${values}]`;
  }

  let type = schema.type || 'any';

  if (schema.format) {
    type = schema.format;
  }

  if (schema.type === 'array' && schema.items) {
    const itemType = formatSchemaType(schema.items);
    return `${itemType}[]`;
  }

  return `<${type}>`;
}
