import type { CommandNode, OperationInfo, Parameter, OpenAPISpec, Schema } from './types.js';
import { resolveRef } from './parser.js';

// Generate help text for root level (list all resource groups)
export function generateRootHelp(apiName: string, root: CommandNode): string {
  const lines: string[] = [];

  lines.push(`${root.name || apiName}`);
  if (root.description) {
    lines.push(`${root.description}`);
  }
  lines.push('');
  lines.push('Commands:');

  // List all child resources
  const children = Array.from(root.children.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  for (const [name, child] of children) {
    const desc = child.description || `Manage ${name}`;
    lines.push(`  ${name.padEnd(20)} ${desc}`);
  }

  // List root-level operations if any
  if (root.operations.size > 0) {
    lines.push('');
    for (const [name, op] of root.operations.entries()) {
      const desc = op.operation.summary || `${op.method.toUpperCase()} ${op.path}`;
      lines.push(`  ${name.padEnd(20)} ${desc}`);
    }
  }

  lines.push('');
  lines.push(`Run '${apiName} <command> --help' for more information.`);

  return lines.join('\n');
}

// Generate help text for a resource (list operations)
export function generateResourceHelp(apiName: string, resourcePath: string[], node: CommandNode): string {
  const lines: string[] = [];
  const fullCommand = [apiName, ...resourcePath].join(' ');

  lines.push(`${fullCommand}`);
  if (node.description) {
    lines.push(`${node.description}`);
  }
  lines.push('');

  // List child resources
  if (node.children.size > 0) {
    lines.push('Subcommands:');
    const children = Array.from(node.children.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    for (const [name, child] of children) {
      const desc = child.description || `Manage ${name}`;
      lines.push(`  ${name.padEnd(20)} ${desc}`);
    }
    lines.push('');
  }

  // List operations
  if (node.operations.size > 0) {
    lines.push('Operations:');
    const ops = Array.from(node.operations.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    for (const [name, op] of ops) {
      const desc = op.operation.summary || `${op.method.toUpperCase()} ${op.path}`;
      lines.push(`  ${name.padEnd(20)} ${desc}`);
    }
    lines.push('');
  }

  lines.push(`Run '${fullCommand} <command> --help' for details.`);

  return lines.join('\n');
}

// Generate help text for an operation
export function generateOperationHelp(
  apiName: string,
  resourcePath: string[],
  opName: string,
  opInfo: OperationInfo,
  spec: OpenAPISpec
): string {
  const lines: string[] = [];
  const fullCommand = [apiName, ...resourcePath, opName].join(' ');

  lines.push(`${fullCommand}`);
  if (opInfo.operation.summary) {
    lines.push(`${opInfo.operation.summary}`);
  }
  if (opInfo.operation.description && opInfo.operation.description !== opInfo.operation.summary) {
    lines.push('');
    lines.push(opInfo.operation.description);
  }
  lines.push('');

  lines.push(`HTTP: ${opInfo.method.toUpperCase()} ${opInfo.path}`);
  lines.push('');

  // Collect all parameters
  const allParams = opInfo.operation.parameters || [];

  // Path parameters
  const pathParams = allParams.filter(p => p.in === 'path');
  if (pathParams.length > 0) {
    lines.push('Path Parameters:');
    for (const param of pathParams) {
      const required = param.required ? ' (required)' : '';
      const desc = param.description || '';
      lines.push(`  --${param.name}${required}`);
      if (desc) lines.push(`      ${desc}`);
    }
    lines.push('');
  }

  // Query parameters
  const queryParams = allParams.filter(p => p.in === 'query');
  if (queryParams.length > 0) {
    lines.push('Query Parameters:');
    for (const param of queryParams) {
      const required = param.required ? ' (required)' : '';
      const desc = param.description || '';
      const schemaInfo = formatSchemaType(param.schema);
      lines.push(`  --${param.name}${required} ${schemaInfo}`);
      if (desc) lines.push(`      ${desc}`);
    }
    lines.push('');
  }

  // Request body
  const requestBody = opInfo.operation.requestBody;
  if (requestBody) {
    const body = '$ref' in requestBody
      ? resolveRef(spec, requestBody.$ref)
      : requestBody;

    if (body && 'content' in body) {
      lines.push('Request Body:');
      const jsonContent = body.content['application/json'];
      if (jsonContent?.schema) {
        const schema = '$ref' in jsonContent.schema
          ? resolveRef<Schema>(spec, jsonContent.schema.$ref)
          : jsonContent.schema;

        if (schema) {
          formatSchemaProperties(lines, schema, spec, '  ');
        }
      }
      lines.push('');
      lines.push('  Use --data=\'{"key":"value"}\' or pipe JSON via stdin');
      lines.push('');
    }
  }

  // Global options
  lines.push('Options:');
  lines.push('  --help              Show this help message');
  lines.push('  --dry-run           Print curl command without executing');
  lines.push('  --verbose           Show request/response details');
  lines.push('  --data=JSON         Request body as JSON string');

  return lines.join('\n');
}

function formatSchemaType(schema?: Schema): string {
  if (!schema) return '';

  let type = schema.type || 'any';

  if (schema.enum) {
    return `[${schema.enum.join('|')}]`;
  }

  if (schema.format) {
    type = `${type}<${schema.format}>`;
  }

  if (schema.type === 'array' && schema.items) {
    const itemType = formatSchemaType(schema.items);
    return `${itemType}[]`;
  }

  return `<${type}>`;
}

function formatSchemaProperties(lines: string[], schema: Schema, spec: OpenAPISpec, indent: string): void {
  if (schema.allOf) {
    for (const subSchema of schema.allOf) {
      const resolved = '$ref' in subSchema
        ? resolveRef<Schema>(spec, (subSchema as { $ref: string }).$ref)
        : subSchema;
      if (resolved) {
        formatSchemaProperties(lines, resolved, spec, indent);
      }
    }
    return;
  }

  if (schema.properties) {
    const required = new Set(schema.required || []);
    for (const [name, propSchema] of Object.entries(schema.properties)) {
      const req = required.has(name) ? ' (required)' : '';
      const type = formatSchemaType(propSchema);
      lines.push(`${indent}${name}${req} ${type}`);
      if (propSchema.description) {
        lines.push(`${indent}    ${propSchema.description}`);
      }
    }
  }
}
