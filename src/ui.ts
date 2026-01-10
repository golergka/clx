// UI utilities: colors, symbols, TTY detection, spinners, prompts
import * as readline from 'readline';

// TTY and color detection
export const isTTY = process.stdout.isTTY ?? false;
export const useColor = isTTY && !process.env.NO_COLOR && !process.env.CLX_NO_COLOR;
export const useUnicode = isTTY && process.env.TERM !== 'dumb';

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[90m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
  blueUnderline: '\x1b[34;4m',
};

// Unicode symbols with ASCII fallbacks
export const symbols = {
  success: useUnicode ? '✓' : '[ok]',
  warning: useUnicode ? '⚠' : '[!]',
  error: useUnicode ? '✗' : '[x]',
  info: useUnicode ? 'ℹ' : '[i]',
  arrow: useUnicode ? '→' : '->',
  bullet: useUnicode ? '•' : '-',
  spinner: useUnicode ? ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] : ['|', '/', '-', '\\'],
};

// Color helpers
export function green(text: string): string {
  return useColor ? `${colors.green}${text}${colors.reset}` : text;
}

export function yellow(text: string): string {
  return useColor ? `${colors.yellow}${text}${colors.reset}` : text;
}

export function red(text: string): string {
  return useColor ? `${colors.red}${text}${colors.reset}` : text;
}

export function cyan(text: string): string {
  return useColor ? `${colors.cyan}${text}${colors.reset}` : text;
}

export function blue(text: string): string {
  return useColor ? `${colors.blue}${text}${colors.reset}` : text;
}

export function blueUnderline(text: string): string {
  return useColor ? `${colors.blueUnderline}${text}${colors.reset}` : text;
}

export function bold(text: string): string {
  return useColor ? `${colors.bold}${text}${colors.reset}` : text;
}

export function dim(text: string): string {
  return useColor ? `${colors.dim}${text}${colors.reset}` : text;
}

// Status line formatting
export function success(message: string): string {
  return `  ${green(symbols.success)} ${message}`;
}

export function warning(message: string): string {
  return `  ${yellow(symbols.warning)} ${message}`;
}

export function error(message: string): string {
  return `  ${red(symbols.error)} ${message}`;
}

export function info(message: string): string {
  return `  ${blue(symbols.info)} ${message}`;
}

// Spinner class for progress indication
export class Spinner {
  private interval: NodeJS.Timeout | null = null;
  private frameIndex = 0;
  private message: string;
  private startTime: number = 0;

  constructor(message: string) {
    this.message = message;
  }

  start(): void {
    if (!isTTY) {
      // Non-TTY: just print the message once
      console.log(`  ${this.message}...`);
      return;
    }

    this.startTime = Date.now();
    this.interval = setInterval(() => {
      const frame = symbols.spinner[this.frameIndex];
      this.frameIndex = (this.frameIndex + 1) % symbols.spinner.length;
      process.stdout.write(`\r  ${cyan(frame)} ${this.message}...`);
    }, 80);
  }

  update(message: string): void {
    this.message = message;
    if (!isTTY) {
      console.log(`  ${this.message}...`);
    }
  }

  stop(finalMessage?: string, status: 'success' | 'error' | 'warning' = 'success'): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    const elapsed = Date.now() - this.startTime;
    const duration = elapsed > 1000 ? ` (${(elapsed / 1000).toFixed(1)}s)` : '';

    if (isTTY) {
      process.stdout.write('\r\x1b[K'); // Clear line
    }

    if (finalMessage) {
      const sym = status === 'success' ? green(symbols.success) :
                  status === 'error' ? red(symbols.error) :
                  yellow(symbols.warning);
      console.log(`  ${sym} ${finalMessage}${dim(duration)}`);
    }
  }
}

// Create a spinner
export function spinner(message: string): Spinner {
  const s = new Spinner(message);
  s.start();
  return s;
}

// Prompt utilities
export async function confirm(message: string, defaultValue = true): Promise<boolean> {
  // In non-TTY mode, use default
  if (!isTTY) {
    return defaultValue;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const hint = defaultValue ? '(Y/n)' : '(y/N)';

  return new Promise((resolve) => {
    rl.question(`  ${cyan('?')} ${message} ${dim(hint)} `, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      if (normalized === '') {
        resolve(defaultValue);
      } else {
        resolve(normalized === 'y' || normalized === 'yes');
      }
    });
  });
}

export async function prompt(message: string, defaultValue?: string): Promise<string> {
  // In non-TTY mode, use default
  if (!isTTY) {
    return defaultValue || '';
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const hint = defaultValue ? dim(` (${defaultValue})`) : '';

  return new Promise((resolve) => {
    rl.question(`  ${cyan('?')} ${message}${hint}: `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

export async function secretPrompt(message: string): Promise<string> {
  // In non-TTY mode, can't hide input
  if (!isTTY) {
    return '';
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    // This doesn't actually hide the input, but we can't do better with readline
    // For actual secret input, we'd need mute-stream or similar
    process.stdout.write(`  ${cyan('?')} ${message}: `);

    // Attempt to hide input (works on some terminals)
    if (process.stdin.isTTY) {
      process.stdin.setRawMode?.(true);
    }

    let input = '';
    const onData = (char: Buffer) => {
      const c = char.toString();
      if (c === '\n' || c === '\r') {
        process.stdin.setRawMode?.(false);
        process.stdin.removeListener('data', onData);
        process.stdout.write('\n');
        rl.close();
        resolve(input);
      } else if (c === '\x7f' || c === '\b') {
        // Backspace
        if (input.length > 0) {
          input = input.slice(0, -1);
        }
      } else if (c === '\x03') {
        // Ctrl+C
        process.exit(1);
      } else {
        input += c;
      }
    };

    process.stdin.on('data', onData);
    process.stdin.resume();
  });
}

// Box drawing for notifications
export function box(lines: string[]): string {
  const maxLen = Math.max(...lines.map(l => stripAnsi(l).length));
  const top = `  ┌${'─'.repeat(maxLen + 2)}┐`;
  const bottom = `  └${'─'.repeat(maxLen + 2)}┘`;
  const content = lines.map(l => {
    const padding = maxLen - stripAnsi(l).length;
    return `  │ ${l}${' '.repeat(padding)} │`;
  });
  return [top, ...content, bottom].join('\n');
}

// Strip ANSI codes for length calculation
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

// Formatted error output
export interface ErrorInfo {
  title: string;
  message: string;
  hint?: string;
  url?: string;
}

export function formatErrorMessage(info: ErrorInfo): string {
  const lines: string[] = [];
  lines.push(`  ${red(symbols.error)} ${bold(info.title)}`);
  lines.push('');
  lines.push(`    ${info.message}`);
  if (info.hint) {
    lines.push('');
    lines.push(`    ${info.hint}`);
  }
  if (info.url) {
    lines.push(`    ${blueUnderline(info.url)}`);
  }
  return lines.join('\n');
}

// Redact sensitive values
export function redact(value: string, showChars = 4): string {
  if (value.length <= showChars * 2) {
    return '*'.repeat(value.length);
  }
  return value.substring(0, showChars) + '****';
}
