// Output formatting utilities

// Extract a field from JSON data using dot notation
export function extractField(data: unknown, fieldPath: string): unknown {
  if (!fieldPath) return data;

  const parts = fieldPath.split('.');
  let current: unknown = data;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }

    if (Array.isArray(current)) {
      // If accessing array, try to get the field from each item
      const index = parseInt(part, 10);
      if (!isNaN(index)) {
        current = current[index];
      } else {
        // Map over array to extract field from each item
        current = current.map(item => {
          if (item && typeof item === 'object' && part in item) {
            return (item as Record<string, unknown>)[part];
          }
          return undefined;
        });
      }
    } else if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }

  return current;
}

// Format data as a table
export function formatTable(data: unknown): string {
  if (data === null || data === undefined) {
    return '';
  }

  // If it's an array of objects, format as table
  if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object' && data[0] !== null) {
    return formatArrayAsTable(data as Record<string, unknown>[]);
  }

  // If it's a single object, format as key-value pairs
  if (typeof data === 'object' && !Array.isArray(data)) {
    return formatObjectAsTable(data as Record<string, unknown>);
  }

  // If it's an array of primitives, format as simple list
  if (Array.isArray(data)) {
    return data.map(item => String(item)).join('\n');
  }

  // Otherwise, just stringify
  return String(data);
}

// Format array of objects as table
function formatArrayAsTable(data: Record<string, unknown>[]): string {
  if (data.length === 0) return '';

  // Get all unique keys from all objects
  const allKeys = new Set<string>();
  for (const item of data) {
    for (const key of Object.keys(item)) {
      allKeys.add(key);
    }
  }

  // Filter to only show scalar values (not nested objects/arrays)
  const keys = Array.from(allKeys).filter(key => {
    return data.some(item => {
      const value = item[key];
      return value !== null && value !== undefined &&
             typeof value !== 'object';
    });
  });

  if (keys.length === 0) {
    // Fallback: show id/name if available
    const idKey = allKeys.has('id') ? 'id' : allKeys.has('name') ? 'name' : Array.from(allKeys)[0];
    if (idKey) {
      keys.push(idKey);
    }
  }

  // Calculate column widths
  const widths: Record<string, number> = {};
  for (const key of keys) {
    widths[key] = key.length;
    for (const item of data) {
      const value = formatCellValue(item[key]);
      widths[key] = Math.max(widths[key], value.length);
    }
    // Cap column width at 50 chars
    widths[key] = Math.min(widths[key], 50);
  }

  // Build table
  const lines: string[] = [];

  // Header
  const header = keys.map(key => key.padEnd(widths[key])).join('  ');
  lines.push(header);

  // Separator
  const separator = keys.map(key => '-'.repeat(widths[key])).join('  ');
  lines.push(separator);

  // Rows
  for (const item of data) {
    const row = keys.map(key => {
      const value = formatCellValue(item[key]);
      return truncate(value, widths[key]).padEnd(widths[key]);
    }).join('  ');
    lines.push(row);
  }

  return lines.join('\n');
}

// Format single object as key-value pairs
function formatObjectAsTable(data: Record<string, unknown>): string {
  const lines: string[] = [];

  // Find max key length
  const maxKeyLen = Math.min(30, Math.max(...Object.keys(data).map(k => k.length)));

  for (const [key, value] of Object.entries(data)) {
    const formattedValue = formatCellValue(value);
    lines.push(`${key.padEnd(maxKeyLen)}  ${formattedValue}`);
  }

  return lines.join('\n');
}

// Format a cell value for table display
function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'boolean') {
    return value ? 'yes' : 'no';
  }

  if (typeof value === 'object') {
    if (Array.isArray(value)) {
      return `[${value.length} items]`;
    }
    return '{...}';
  }

  return String(value);
}

// Truncate string with ellipsis
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen - 3) + '...';
}

// Format output based on flags
export function formatOutput(
  data: unknown,
  options: {
    format?: 'json' | 'table';
    field?: string;
    pretty?: boolean;
  } = {}
): string {
  const { format = 'json', field, pretty = true } = options;

  // Extract field if specified
  let output = field ? extractField(data, field) : data;

  // Format based on output type
  if (format === 'table') {
    return formatTable(output);
  }

  // JSON output
  if (pretty) {
    return JSON.stringify(output, null, 2);
  }

  return JSON.stringify(output);
}
