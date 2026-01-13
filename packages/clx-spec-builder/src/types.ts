// Types for clx-spec-builder

export interface SessionConfig {
  name: string;
  displayName?: string;
  docsUrls: string[];
  provider: 'google' | 'anthropic' | 'openai';
  clxRoot: string;
  outputDir: string;
}

export interface SessionState {
  config: SessionConfig;
  apiCallsSucceeded: number;
  apiCallsFailed: number;
  specPath: string | null;
  adapterPath: string | null;
}

export interface ApiCallResult {
  success: boolean;
  status?: number;
  data?: unknown;
  error?: string;
  buildErrors?: string[];
}

export interface LintResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface CompletionCheck {
  passed: boolean;
  checks: {
    specValid: boolean;
    hasOperationIds: boolean;
    adapterValid: boolean;
    apiCallSucceeded: boolean;
    noTypeErrors: boolean;
  };
  errors: string[];
}
