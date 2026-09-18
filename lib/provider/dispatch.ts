// The in-site provider dispatcher — the ONLY component that makes an
// outbound network call, and only when the user configured their own
// provider key (docs/SPEC.md §10, §16).
//
// Privacy guarantee (docs/ARCHITECTURE.md §6):
// 1. Stores everything on the user's own machine and initiates nothing of its own.
// 2. With a provider key configured, sends only what that feature needs,
//    only to the provider chosen.
// 3. Connected agent is outside our boundary.
//
// Telemetry, update checks, and analytics: ZERO, unconditionally.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export interface ProviderConfig {
  provider: "anthropic" | "openai" | "google" | "custom";
  apiKey: string;
  baseUrl: string;
}

const PROVIDER_CONFIG_RELATIVE = path.join("tended", "provider.json");
const PROVIDER_KEY_RELATIVE = path.join("tended", "provider.key");

// --- Credential Store ---

/**
 * Encrypts the key against being read incidentally (accidentally committed, casually opened,
 * swept up by a backup tool that doesn't preserve permissions) but does not protect against
 * an attacker who already has the same OS-user's access to the machine. This relies on fs.chmod
 * mode 0o600 which affords no real protection on Windows or platforms where file permissions
 * cannot be trusted.
 * 
 * Capability Status:
 * - Credential encryption: implemented and tested
 * - OS keychain integration: unsupported (would require a new dependency)
 */
function getEncryptionKey(lifeRoot: string): Buffer {
  const keyPath = path.join(lifeRoot, PROVIDER_KEY_RELATIVE);
  if (!fs.existsSync(keyPath)) {
    const newKey = crypto.randomBytes(32);
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    // Mode 0o600 restricts read/write to the owner on POSIX.
    fs.writeFileSync(keyPath, newKey, { mode: 0o600 });
  }
  return fs.readFileSync(keyPath);
}

function encryptConfig(config: ProviderConfig, lifeRoot: string): string {
  const key = getEncryptionKey(lifeRoot);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const payload = JSON.stringify(config);
  
  let encrypted = cipher.update(payload, "utf8", "base64");
  encrypted += cipher.final("base64");
  const authTag = cipher.getAuthTag().toString("base64");
  
  return JSON.stringify({
    version: 1,
    iv: iv.toString("base64"),
    authTag,
    data: encrypted
  });
}

function decryptConfig(fileContent: string, lifeRoot: string): ProviderConfig | null {
  try {
    const parsed = JSON.parse(fileContent);
    // Plaintext detection
    if (parsed.apiKey && typeof parsed.apiKey === "string" && !parsed.version) {
      throw new Error("Found unencrypted provider config. Please migrate or clear your settings to use the in-site assistant.");
    }
    
    if (parsed.version !== 1 || !parsed.iv || !parsed.authTag || !parsed.data) {
      return null;
    }
    
    const key = getEncryptionKey(lifeRoot);
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm", 
      key, 
      Buffer.from(parsed.iv, "base64")
    );
    decipher.setAuthTag(Buffer.from(parsed.authTag, "base64"));
    
    let decrypted = decipher.update(parsed.data, "base64", "utf8");
    decrypted += decipher.final("utf8");
    
    return JSON.parse(decrypted) as ProviderConfig;
  } catch (err) {
    if (err instanceof Error && err.message.includes("Found unencrypted")) {
      throw err;
    }
    return null;
  }
}

/**
 * Resolves the in-site provider configuration.
 * Checked first from environment variables, then from `tended/provider.json`.
 * Returns `null` if no provider key is configured.
 */
export function getProviderConfig(lifeRoot: string): ProviderConfig | null {
  const envKey = process.env.WEALLHATELIFE_PROVIDER_KEY;
  const envUrl = process.env.WEALLHATELIFE_PROVIDER_URL;
  const envProvider = (process.env.WEALLHATELIFE_PROVIDER as ProviderConfig["provider"]) || "custom";

  if (envKey && envKey.trim().length > 0) {
    return {
      provider: envProvider,
      apiKey: envKey.trim(),
      baseUrl: envUrl || defaultEndpointFor(envProvider),
    };
  }

  const filePath = path.join(lifeRoot, PROVIDER_CONFIG_RELATIVE);
  if (fs.existsSync(filePath)) {
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch {
      return null;
    }
    const config = decryptConfig(content, lifeRoot);
    if (config) {
      return {
        provider: config.provider || "custom",
        apiKey: config.apiKey.trim(),
        baseUrl: config.baseUrl || defaultEndpointFor(config.provider || "custom")
      };
    }
  }

  return null;
}

/** Saves the provider configuration to `tended/provider.json` encrypted. */
export function setProviderConfig(lifeRoot: string, config: ProviderConfig): void {
  const filePath = path.join(lifeRoot, PROVIDER_CONFIG_RELATIVE);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const encrypted = encryptConfig(config, lifeRoot);
  fs.writeFileSync(filePath, encrypted + "\n", "utf8");
}

/** Removes the provider configuration. */
export function clearProviderConfig(lifeRoot: string): void {
  const filePath = path.join(lifeRoot, PROVIDER_CONFIG_RELATIVE);
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath);
  }
  const keyPath = path.join(lifeRoot, PROVIDER_KEY_RELATIVE);
  if (fs.existsSync(keyPath)) {
    fs.rmSync(keyPath);
  }
}

function defaultEndpointFor(provider: ProviderConfig["provider"]): string {
  switch (provider) {
    case "anthropic":
      return "https://api.anthropic.com/v1/messages";
    case "openai":
      return "https://api.openai.com/v1/chat/completions";
    case "google":
      return "https://generativelanguage.googleapis.com/v1beta";
    default:
      return "https://api.custom-ai-provider.invalid/v1";
  }
}

// --- Provider Adapters ---

export interface ProviderRequest {
  prompt: string;
}

export interface ProviderResponse {
  output: string;
  provider: string;
  endpoint: string;
}

interface FetchArgs {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

export interface ProviderAdapter {
  buildFetchArgs(request: ProviderRequest, config: ProviderConfig): FetchArgs;
  parseResponse(responseBody: string): string;
}

class AnthropicAdapter implements ProviderAdapter {
  buildFetchArgs(request: ProviderRequest, config: ProviderConfig): FetchArgs {
    return {
      url: config.baseUrl,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 1024,
        messages: [{ role: "user", content: request.prompt }]
      })
    };
  }
  parseResponse(responseBody: string): string {
    const data = JSON.parse(responseBody);
    return data.content?.[0]?.text || "";
  }
}

class OpenAIAdapter implements ProviderAdapter {
  buildFetchArgs(request: ProviderRequest, config: ProviderConfig): FetchArgs {
    return {
      url: config.baseUrl,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{ role: "user", content: request.prompt }]
      })
    };
  }
  parseResponse(responseBody: string): string {
    const data = JSON.parse(responseBody);
    return data.choices?.[0]?.message?.content || "";
  }
}

class GoogleAdapter implements ProviderAdapter {
  buildFetchArgs(request: ProviderRequest, config: ProviderConfig): FetchArgs {
    // Note: Google's URL usually needs the key in the query string, 
    // but we can put it in headers depending on the exact endpoint.
    // For simplicity we will assume standard x-goog-api-key header.
    return {
      url: config.baseUrl, // e.g. https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": config.apiKey
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: request.prompt }] }]
      })
    };
  }
  parseResponse(responseBody: string): string {
    const data = JSON.parse(responseBody);
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  }
}

class CustomAdapter implements ProviderAdapter {
  buildFetchArgs(request: ProviderRequest, config: ProviderConfig): FetchArgs {
    return {
      url: config.baseUrl,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({ prompt: request.prompt })
    };
  }
  parseResponse(responseBody: string): string {
    // Try both raw text or simple JSON { output: "..." } depending on custom mock
    try {
      const data = JSON.parse(responseBody);
      return data.output || data.response || responseBody;
    } catch {
      return responseBody;
    }
  }
}

function getAdapter(provider: ProviderConfig["provider"]): ProviderAdapter {
  switch (provider) {
    case "anthropic": return new AnthropicAdapter();
    case "openai": return new OpenAIAdapter();
    case "google": return new GoogleAdapter();
    case "custom":
    default: return new CustomAdapter();
  }
}

// --- Dispatcher ---

/**
 * Dispatches a prompt to the configured AI provider.
 *
 * Guaranteed:
 * - If no key is configured, throws before touching any network interface.
 * - If a key is configured, calls ONLY the configured provider endpoint.
 * - Never calls telemetry, analytics, update checkers, or third-party hosts.
 * - A credential must never reach a log, an error message, a stack trace.
 */
export async function dispatchProviderRequest(
  lifeRoot: string,
  request: ProviderRequest,
): Promise<ProviderResponse> {
  const config = getProviderConfig(lifeRoot);
  if (!config) {
    throw new Error(
      "No in-site provider key is configured. The OhMyLife server initiates no outbound connections of its own.",
    );
  }

  const adapter = getAdapter(config.provider);
  const args = adapter.buildFetchArgs(request, config);

  let responseText: string;
  try {
    // Strictly dials the configured provider's endpoint and nothing else.
    const response = await fetch(args.url, {
      method: args.method,
      headers: args.headers,
      body: args.body,
    });
    
    responseText = await response.text();
    
    if (!response.ok) {
      throw new Error(`Provider returned ${response.status}`);
    }
  } catch (err) {
    // Catch block ensures we do not leak the API key in a thrown error from fetch
    // like if fetch echoes back the URL which might contain the key (for some providers)
    // or if the error object itself logs headers.
    if (err instanceof Error && err.name === "EgressBlocked") throw err;
    throw new Error("Provider request failed. Check your network or provider settings.");
  }

  let output: string;
  try {
    output = adapter.parseResponse(responseText);
  } catch (_err) {
    throw new Error("Failed to parse provider response.");
  }

  return {
    output,
    provider: config.provider,
    endpoint: config.baseUrl,
  };
}
