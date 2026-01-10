import * as fs from 'fs';
import * as readline from 'readline';
import type { AuthProfile, OpenAPISpec, SecurityScheme, OAuthFlow } from './types.js';
import {
  loadAuth,
  saveAuthProfile,
  removeAuth,
  removeAuthProfile,
  getAuthProfile,
  listAuthProfiles,
  setDefaultAuthProfile,
  getEnvApiKey,
  getApiConfig
} from './config.js';
import { loadAdapter } from './adapter-loader.js';
import type { AdapterAuthConfig } from './core/index.js';

// Interactive prompt helper
async function prompt(question: string, hidden = false, apiName?: string): Promise<string> {
  // Check if we're in a TTY
  if (!process.stdin.isTTY) {
    const adapter = apiName ? loadAdapter(apiName) : null;
    const envVarHint = adapter?.auth?.envVar
      ? `  - Set ${adapter.auth.envVar} environment variable\n`
      : `  - Set <API>_API_KEY environment variable\n`;

    throw new Error(
      'Interactive authentication requires a terminal.\n' +
      'For non-interactive use:\n' +
      envVarHint +
      '  - Use --token=<value> flag\n' +
      '  - Use -H "Authorization: Bearer <token>" for custom headers'
    );
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    if (hidden) {
      process.stdout.write(question);
      let input = '';

      process.stdin.setRawMode(true);
      process.stdin.resume();

      process.stdin.on('data', (char) => {
        const c = char.toString();
        if (c === '\n' || c === '\r') {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          rl.close();
          console.log();
          resolve(input);
        } else if (c === '\u0003') {
          // Ctrl+C
          process.exit(1);
        } else if (c === '\u007F') {
          // Backspace
          input = input.slice(0, -1);
        } else {
          input += c;
        }
      });
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
}

// Detect auth type from OpenAPI spec
export function detectAuthType(spec: OpenAPISpec): { type: string; scheme?: SecurityScheme } | null {
  const securitySchemes = spec.components?.securitySchemes;
  if (!securitySchemes) return null;

  // Find the first security scheme
  for (const [name, scheme] of Object.entries(securitySchemes)) {
    if (scheme.type === 'apiKey') {
      return { type: 'apiKey', scheme };
    }
    if (scheme.type === 'http') {
      if (scheme.scheme === 'bearer') {
        return { type: 'bearer', scheme };
      }
      if (scheme.scheme === 'basic') {
        return { type: 'basic', scheme };
      }
    }
    if (scheme.type === 'oauth2') {
      return { type: 'oauth2', scheme };
    }
  }

  return null;
}

// Get OAuth2 flow details from security scheme
function getOAuth2Flow(scheme: SecurityScheme): { flow: OAuthFlow; type: string } | null {
  if (!scheme.flows) return null;

  // Prefer authorization code flow, then client credentials, then implicit
  if (scheme.flows.authorizationCode) {
    return { flow: scheme.flows.authorizationCode, type: 'authorizationCode' };
  }
  if (scheme.flows.clientCredentials) {
    return { flow: scheme.flows.clientCredentials, type: 'clientCredentials' };
  }
  if (scheme.flows.password) {
    return { flow: scheme.flows.password, type: 'password' };
  }
  if (scheme.flows.implicit) {
    return { flow: scheme.flows.implicit, type: 'implicit' };
  }

  return null;
}

// Refresh an OAuth2 access token
export async function refreshOAuth2Token(profile: AuthProfile, apiName: string, profileName: string = 'default'): Promise<AuthProfile | null> {
  if (profile.type !== 'oauth2' || !profile.oauth2) {
    return null;
  }

  const { refreshToken, tokenUrl, refreshUrl, clientId, clientSecret } = profile.oauth2;

  if (!refreshToken) {
    console.error('No refresh token available. Please re-authenticate.');
    return null;
  }

  const url = refreshUrl || tokenUrl;
  if (!url) {
    console.error('No token URL available for refresh.');
    return null;
  }

  try {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });

    if (clientId) {
      body.set('client_id', clientId);
    }
    if (clientSecret) {
      body.set('client_secret', clientSecret);
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`Token refresh failed: ${error}`);
      return null;
    }

    const data = await response.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    // Update profile with new tokens
    const newProfile: AuthProfile = {
      ...profile,
      oauth2: {
        ...profile.oauth2,
        accessToken: data.access_token,
        refreshToken: data.refresh_token || refreshToken,
        expiresAt: data.expires_in
          ? Math.floor(Date.now() / 1000) + data.expires_in
          : profile.oauth2.expiresAt,
      },
    };

    // Save updated profile
    saveAuthProfile(apiName, newProfile, profileName);

    return newProfile;
  } catch (error) {
    console.error(`Token refresh error: ${error}`);
    return null;
  }
}

/**
 * Build an AuthProfile from an environment variable value based on adapter auth config
 */
function buildAuthProfileFromEnv(authConfig: AdapterAuthConfig | undefined, value: string): AuthProfile {
  const type = authConfig?.type || 'bearer';

  switch (type) {
    case 'bearer':
      return { type: 'bearer', bearerToken: value };

    case 'apiKey':
      return {
        type: 'apiKey',
        apiKey: value,
        apiKeyHeader: authConfig?.header || 'Authorization',
        apiKeyQuery: authConfig?.query,
      };

    case 'basic':
      // Support USER:PASS format
      const colonIndex = value.indexOf(':');
      if (colonIndex > 0) {
        return {
          type: 'basic',
          username: value.substring(0, colonIndex),
          password: value.substring(colonIndex + 1),
        };
      }
      // If no colon, treat as bearer token
      return { type: 'bearer', bearerToken: value };

    case 'oauth2':
      // For env var, treat as access token
      return {
        type: 'oauth2',
        oauth2: { accessToken: value },
      };

    default:
      return { type: 'bearer', bearerToken: value };
  }
}

/**
 * Get auth from environment variable using adapter config
 */
function getAuthFromEnv(apiName: string): AuthProfile | null {
  const adapter = loadAdapter(apiName);

  // Check adapter-specific env var first (e.g., STRIPE_API_KEY, GITHUB_TOKEN)
  if (adapter?.auth?.envVar) {
    const envValue = process.env[adapter.auth.envVar];
    if (envValue) {
      return buildAuthProfileFromEnv(adapter.auth, envValue);
    }
  }

  // Check for basic auth env vars (envVarUser and envVarPass)
  if (adapter?.auth?.envVarUser && adapter?.auth?.envVarPass) {
    const user = process.env[adapter.auth.envVarUser];
    const pass = process.env[adapter.auth.envVarPass];
    if (user && pass) {
      return { type: 'basic', username: user, password: pass };
    }
  }

  // Fallback: check generic patterns
  // CLX_<API>_TOKEN (e.g., CLX_STRIPE_TOKEN)
  const clxEnvVar = `CLX_${apiName.toUpperCase()}_TOKEN`;
  const clxValue = process.env[clxEnvVar];
  if (clxValue) {
    return buildAuthProfileFromEnv(adapter?.auth, clxValue);
  }

  // <API>_API_KEY (e.g., STRIPE_API_KEY) - legacy fallback
  const legacyEnvKey = getEnvApiKey(apiName);
  if (legacyEnvKey) {
    return buildAuthProfileFromEnv(adapter?.auth, legacyEnvKey);
  }

  return null;
}

// Check if token needs refresh and refresh if needed
export async function ensureValidToken(apiName: string, profileName?: string): Promise<AuthProfile | null> {
  // First check for environment variable authentication
  const envAuth = getAuthFromEnv(apiName);
  if (envAuth) {
    return envAuth;
  }

  // Get profile name from config if not specified
  const apiConfig = getApiConfig(apiName);
  const effectiveProfileName = profileName || apiConfig.profile;

  const profile = getAuthProfile(apiName, effectiveProfileName);
  if (!profile) return null;

  if (profile.type !== 'oauth2' || !profile.oauth2) {
    return profile;
  }

  const { expiresAt, refreshToken } = profile.oauth2;

  // If no expiration set or no refresh token, just return current profile
  if (!expiresAt || !refreshToken) {
    return profile;
  }

  // Check if token expires in the next 5 minutes
  const now = Math.floor(Date.now() / 1000);
  const bufferSeconds = 300; // 5 minutes

  if (expiresAt - now <= bufferSeconds) {
    console.error('Access token expired or expiring soon, refreshing...');
    const refreshed = await refreshOAuth2Token(profile, apiName, effectiveProfileName || 'default');
    return refreshed || profile;
  }

  return profile;
}

// Interactive login flow
export async function authLogin(apiName: string, spec: OpenAPISpec, profileName: string = 'default'): Promise<void> {
  const authInfo = detectAuthType(spec);

  if (!authInfo) {
    console.error('No authentication method detected in API spec.');
    console.error('You can manually configure auth in ~/.config/clx/auth/' + apiName + '.json');
    process.exit(1);
  }

  let config: AuthProfile;

  switch (authInfo.type) {
    case 'apiKey': {
      const scheme = authInfo.scheme!;
      console.log(`This API uses API key authentication.`);
      console.log(`Key location: ${scheme.in} (${scheme.name})`);
      console.log();

      const apiKey = await prompt('Enter your API key: ', true, apiName);

      config = {
        type: 'apiKey',
        apiKey,
      };

      if (scheme.in === 'header') {
        config.apiKeyHeader = scheme.name;
      } else if (scheme.in === 'query') {
        config.apiKeyQuery = scheme.name;
      }
      break;
    }

    case 'bearer': {
      console.log('This API uses Bearer token authentication.');
      console.log();

      const token = await prompt('Enter your Bearer token: ', true, apiName);

      config = {
        type: 'bearer',
        bearerToken: token,
      };
      break;
    }

    case 'basic': {
      console.log('This API uses Basic authentication.');
      console.log();

      const username = await prompt('Username: ', false, apiName);
      const password = await prompt('Password: ', true, apiName);

      config = {
        type: 'basic',
        username,
        password,
      };
      break;
    }

    case 'oauth2': {
      const scheme = authInfo.scheme!;
      console.log('This API uses OAuth 2.0 authentication.');

      const flowInfo = getOAuth2Flow(scheme);

      if (flowInfo) {
        console.log(`OAuth 2.0 flow: ${flowInfo.type}`);
        console.log();

        if (flowInfo.type === 'clientCredentials') {
          // Client credentials flow - automated
          const clientId = await prompt('Client ID: ', false, apiName);
          const clientSecret = await prompt('Client Secret: ', true, apiName);

          console.log('Fetching access token...');

          const body = new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: clientId,
            client_secret: clientSecret,
          });

          // Add scopes if available
          const scopes = Object.keys(flowInfo.flow.scopes || {});
          if (scopes.length > 0) {
            body.set('scope', scopes.join(' '));
          }

          try {
            const response = await fetch(flowInfo.flow.tokenUrl!, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: body.toString(),
            });

            if (!response.ok) {
              const error = await response.text();
              console.error(`Token fetch failed: ${error}`);
              process.exit(1);
            }

            const data = await response.json() as {
              access_token: string;
              refresh_token?: string;
              expires_in?: number;
            };

            config = {
              type: 'oauth2',
              oauth2: {
                accessToken: data.access_token,
                refreshToken: data.refresh_token,
                expiresAt: data.expires_in
                  ? Math.floor(Date.now() / 1000) + data.expires_in
                  : undefined,
                tokenUrl: flowInfo.flow.tokenUrl,
                refreshUrl: flowInfo.flow.refreshUrl,
                clientId,
                clientSecret,
                scopes,
              },
            };
          } catch (error) {
            console.error(`Failed to fetch token: ${error}`);
            process.exit(1);
          }
        } else {
          // Authorization code or other flows - manual token entry for now
          console.log('Authorization Code flow detected.');
          console.log(`Authorization URL: ${flowInfo.flow.authorizationUrl}`);
          console.log(`Token URL: ${flowInfo.flow.tokenUrl}`);
          console.log();
          console.log('Please complete the OAuth flow in your browser and paste the tokens here.');
          console.log();

          const clientId = await prompt('Client ID (optional): ', false, apiName);
          const clientSecret = await prompt('Client Secret (optional): ', true, apiName);
          const accessToken = await prompt('Access token: ', true, apiName);
          const refreshToken = await prompt('Refresh token (optional): ', true, apiName);
          const expiresInStr = await prompt('Expires in seconds (optional): ', false, apiName);

          config = {
            type: 'oauth2',
            oauth2: {
              accessToken,
              refreshToken: refreshToken || undefined,
              expiresAt: expiresInStr
                ? Math.floor(Date.now() / 1000) + parseInt(expiresInStr, 10)
                : undefined,
              tokenUrl: flowInfo.flow.tokenUrl,
              refreshUrl: flowInfo.flow.refreshUrl,
              clientId: clientId || undefined,
              clientSecret: clientSecret || undefined,
              scopes: Object.keys(flowInfo.flow.scopes || {}),
            },
          };
        }
      } else {
        // No flow info, just ask for token directly
        console.log('Please provide an access token directly.');
        console.log();

        const accessToken = await prompt('Access token: ', true, apiName);
        const refreshToken = await prompt('Refresh token (optional): ', true, apiName);

        config = {
          type: 'oauth2',
          oauth2: {
            accessToken,
            refreshToken: refreshToken || undefined,
          },
        };
      }
      break;
    }

    default:
      console.error(`Unsupported auth type: ${authInfo.type}`);
      process.exit(1);
  }

  saveAuthProfile(apiName, config, profileName);
  console.log();
  console.log(`Authentication saved for ${apiName} (profile: ${profileName}).`);
}

// Show auth status
export function authStatus(apiName: string, profileName?: string): void {
  const config = loadAuth(apiName);

  if (!config) {
    console.log(`Not authenticated. Run '${apiName} auth login' to configure.`);
    return;
  }

  const profiles = Object.keys(config.profiles);
  console.log(`Authentication for ${apiName}`);
  console.log(`  Default profile: ${config.defaultProfile}`);
  console.log(`  Available profiles: ${profiles.join(', ')}`);
  console.log();

  // Show specific profile or default
  const name = profileName || config.defaultProfile;
  const profile = config.profiles[name];

  if (!profile) {
    console.log(`Profile '${name}' not found.`);
    return;
  }

  console.log(`Profile: ${name}`);
  console.log(`  Type: ${profile.type}`);

  switch (profile.type) {
    case 'apiKey':
      if (profile.apiKeyHeader) {
        console.log(`  Header: ${profile.apiKeyHeader}`);
      }
      if (profile.apiKeyQuery) {
        console.log(`  Query param: ${profile.apiKeyQuery}`);
      }
      console.log(`  Key: ${profile.apiKey?.substring(0, 8)}...`);
      break;
    case 'bearer':
      console.log(`  Token: ${profile.bearerToken?.substring(0, 8)}...`);
      break;
    case 'basic':
      console.log(`  Username: ${profile.username}`);
      break;
    case 'oauth2':
      console.log(`  Access token: ${profile.oauth2?.accessToken?.substring(0, 8)}...`);
      if (profile.oauth2?.refreshToken) {
        console.log(`  Refresh token: ${profile.oauth2.refreshToken.substring(0, 8)}...`);
      }
      if (profile.oauth2?.expiresAt) {
        const expires = new Date(profile.oauth2.expiresAt * 1000);
        const now = new Date();
        const isExpired = expires < now;
        console.log(`  Expires: ${expires.toISOString()}${isExpired ? ' (EXPIRED)' : ''}`);
      }
      if (profile.oauth2?.scopes?.length) {
        console.log(`  Scopes: ${profile.oauth2.scopes.join(', ')}`);
      }
      break;
  }
}

// Logout (remove auth)
export function authLogout(apiName: string, profileName?: string): void {
  if (profileName) {
    // Remove specific profile
    const removed = removeAuthProfile(apiName, profileName);
    if (removed) {
      console.log(`Removed profile '${profileName}' from ${apiName}.`);
    } else {
      console.log(`Profile '${profileName}' not found for ${apiName}.`);
    }
  } else {
    // Remove all auth
    const removed = removeAuth(apiName);
    if (removed) {
      console.log(`Logged out from ${apiName}.`);
    } else {
      console.log(`No authentication found for ${apiName}.`);
    }
  }
}

// List all profiles
export function authList(apiName: string): void {
  const profiles = listAuthProfiles(apiName);

  if (profiles.length === 0) {
    console.log(`No profiles configured for ${apiName}.`);
    return;
  }

  const config = loadAuth(apiName);
  console.log(`Profiles for ${apiName}:`);
  for (const name of profiles) {
    const isDefault = config?.defaultProfile === name;
    console.log(`  ${name}${isDefault ? ' (default)' : ''}`);
  }
}

// Switch default profile
export function authSwitch(apiName: string, profileName: string): void {
  const success = setDefaultAuthProfile(apiName, profileName);
  if (success) {
    console.log(`Default profile set to '${profileName}' for ${apiName}.`);
  } else {
    console.log(`Profile '${profileName}' not found for ${apiName}.`);
  }
}
