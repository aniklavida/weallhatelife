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

export interface ProviderConfig {
  provider: "anthropic" | "openai" | "google" | "custom";
  apiKey: string;
  baseUrl: string;
}

const PROVIDER_CONFIG_RELATIVE = path.join("tended", "provider.json");

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
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<ProviderConfig>;
      if (parsed.apiKey && typeof parsed.apiKey === "string" && parsed.apiKey.trim().length > 0) {
        const provider = parsed.provider || "custom";
        return {
          provider,
          apiKey: parsed.apiKey.trim(),
          baseUrl: parsed.baseUrl || defaultEndpointFor(provider),
        };
      }
    } catch {
      return null;
    }
  }

  return null;
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

/** Saves the provider configuration to `tended/provider.json`. */
export function setProviderConfig(lifeRoot: string, config: ProviderConfig): void {
  const filePath = path.join(lifeRoot, PROVIDER_CONFIG_RELATIVE);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + "\n", "utf8");
}

/** Removes the provider configuration. */
export function clearProviderConfig(lifeRoot: string): void {
  const filePath = path.join(lifeRoot, PROVIDER_CONFIG_RELATIVE);
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath);
  }
}

export interface ProviderRequest {
  prompt: string;
}

export interface ProviderResponse {
  output: string;
  provider: string;
  endpoint: string;
}

/**
 * Dispatches a prompt to the configured AI provider.
 *
 * Guaranteed:
 * - If no key is configured, throws before touching any network interface.
 * - If a key is configured, calls ONLY the configured provider endpoint.
 * - Never calls telemetry, analytics, update checkers, or third-party hosts.
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

  // Strictly dials the configured provider's endpoint and nothing else.
  const response = await fetch(config.baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({ prompt: request.prompt }),
  });

  return {
    output: await response.text(),
    provider: config.provider,
    endpoint: config.baseUrl,
  };
}
