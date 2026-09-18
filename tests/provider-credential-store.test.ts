import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { setProviderConfig } from "../lib/provider/dispatch";
import { cleanupDir, makeTempDir } from "./helpers";

const PROVIDER_CONFIG_RELATIVE = path.join("tended", "provider.json");
const PROVIDER_KEY_RELATIVE = path.join("tended", "provider.key");

describe("Provider Credential Store Storage Format", () => {
  const cleanupDirs: string[] = [];

  afterAll(() => {
    while (cleanupDirs.length > 0) {
      cleanupDir(cleanupDirs.pop() as string);
    }
  });

  it("does not store the API key in plaintext and enforces correct key permissions", () => {
    const lifeRoot = makeTempDir("provider-credential-store");
    cleanupDirs.push(lifeRoot);

    // Synthesise a fake key at runtime from fragments
    const fakeKey = ["test", "prov", "key", "token", "99"].join("-");
    
    setProviderConfig(lifeRoot, {
      provider: "custom",
      apiKey: fakeKey,
      baseUrl: "https://weallhatelife.invalid/v1/chat",
    });

    const configPath = path.join(lifeRoot, PROVIDER_CONFIG_RELATIVE);
    const rawBytes = fs.readFileSync(configPath, "utf8");

    // Assert that the raw fake key string does not appear anywhere in those bytes.
    expect(rawBytes).not.toContain(fakeKey);

    // Assert that the key file exists and has file mode 0o600 on POSIX
    const keyPath = path.join(lifeRoot, PROVIDER_KEY_RELATIVE);
    expect(fs.existsSync(keyPath)).toBe(true);
    
    if (process.platform !== "win32") {
      const mode = fs.statSync(keyPath).mode;
      expect(mode & 0o777).toBe(0o600);
    }
  });
});
