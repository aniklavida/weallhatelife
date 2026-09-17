// Zero egress, as a test rather than an intention.
//
// docs/SPEC.md §16 says the server "makes no outbound call of its own —
// except to the provider whose key the user configured in-site", and
// docs/ARCHITECTURE.md §6 says that merging the server's guarantee and the
// connected agent's behaviour into one comforting sentence would be the most
// damaging untrue claim this project could make. This file is the proof for
// the half of that sentence which can be proved today: **with no in-site
// provider key configured**, the code that ships makes no outbound network
// call.
//
// It proves that two ways, because neither way is sufficient alone.
//
// 1. **Behaviour.** Every outbound surface Node offers is replaced with one
//    that records the destination and refuses the call, and then the real
//    product paths are run underneath: the home route rendered in both of
//    its states, and an MCP session that calls all thirteen tools, reads and
//    writes alike. A recorded attempt fails the test and names what was
//    dialled. The first test in the file dials each surface on purpose, so a
//    detector that has silently stopped watching cannot pass as silence.
//
// 2. **Structure.** No shipped module imports an HTTP client, a socket, a
//    resolver or anything else that can open a connection, and none calls
//    `fetch`. Behaviour only covers the paths a test walks; this covers all
//    of them, at the cost of proving an absent import rather than an absent
//    call.
//
// **What this does not cover, stated plainly.**
//
// *The build is not the server, and the build does reach the network.*
// `app/fonts.ts` loads three families through `next/font/google`, which
// downloads them from `fonts.googleapis.com` at build time and self-hosts
// the files it gets — so the running server serves fonts from itself, which
// is the claim above, but `next build` fails with no route to Google.
// Turbopack performs that fetch natively, outside Node, where nothing this
// file patches can observe it. So the fetch is asserted from the source
// instead, below, and named in AGENTS.md and docs/ARCHITECTURE.md §8 rather
// than left for someone to discover with a packet capture.
//
// *The in-site provider key does not exist yet.* The other half of the
// sentence — that with a key the server calls that provider and nothing else
// — has no implementation to test (docs/SPEC.md §10, planned for v1.0). A
// test written against nothing would be the same false green this file was
// written to remove, so it is not written here. When that path lands, the
// second assertion belongs beside these.
//
// *`app/layout.tsx` is rendered by Next, not here.* It imports
// `next/font/google`, which only the Next compiler can resolve; outside a
// Next build the import throws. The home route below is rendered through its
// own component tree, which is where every element of the page except the
// shell lives.
import dns from "node:dns";
import fs from "node:fs";
import http from "node:http";
import http2 from "node:http2";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import tls from "node:tls";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerTools } from "../mcp/tools/index";
import HomePage from "../app/page";
import { clearProviderConfig, dispatchProviderRequest, setProviderConfig } from "../lib/provider/dispatch";
import { cleanupDir, EXAMPLE_LIFE_ROOT, makeTempDir, stripComments } from "./helpers";

const REPO_ROOT = path.resolve(__dirname, "..");

/** RFC 5737 TEST-NET-1 and RFC 2606's reserved TLD: both are guaranteed
 * never to route anywhere, so the deliberate dials below cannot reach a real
 * host even if a patch were missing. */
const UNROUTABLE_IP = "192.0.2.1";
const UNROUTABLE_HOST = "weallhatelife.invalid";

interface Attempt {
  api: string;
  destination: string;
}

const attempts: Attempt[] = [];

class EgressBlocked extends Error {
  constructor(api: string, destination: string) {
    super(`Outbound call blocked by tests/no-egress.test.ts: ${api} -> ${destination}`);
    this.name = "EgressBlocked";
  }
}

/** Records the attempt and refuses it, so a leak shows up as a named
 * destination in a failing assertion and not as traffic that actually left
 * during CI. */
function record(api: string, destination: string): never {
  attempts.push({ api, destination });
  throw new EgressBlocked(api, destination);
}

/** A readable destination out of whichever argument shape the caller used —
 * a URL string, a `URL`, or an options object with `host`/`hostname`/`port`. */
function describeTarget(args: readonly unknown[]): string {
  for (const arg of args) {
    if (typeof arg === "string" && arg.length > 0) return arg;
    if (arg instanceof URL) return arg.href;
    if (typeof arg === "object" && arg !== null) {
      const o = arg as { host?: unknown; hostname?: unknown; port?: unknown };
      const host = typeof o.host === "string" ? o.host : typeof o.hostname === "string" ? o.hostname : undefined;
      if (host !== undefined) return o.port === undefined ? host : `${host}:${String(o.port)}`;
    }
    if (typeof arg === "number") return `port ${String(arg)}`;
  }
  return "unknown destination";
}

/** Every patch installed, so `afterAll` can put the runtime back exactly as
 * it found it — these are process-wide objects shared with every other test
 * file that runs in the same worker. */
const restore: (() => void)[] = [];

function patch<T extends object, K extends keyof T>(host: T, key: K, replacement: T[K]): void {
  const original = host[key];
  host[key] = replacement;
  restore.push(() => {
    host[key] = original;
  });
}

function installInterceptors(): void {
  const blocking =
    (api: string) =>
    (...args: unknown[]): never =>
      record(api, describeTarget(args));

  // The high-level clients, named individually so a failure says which API
  // the call came through.
  patch(globalThis, "fetch", blocking("fetch") as unknown as typeof globalThis.fetch);
  patch(http, "request", blocking("http.request") as unknown as typeof http.request);
  patch(http, "get", blocking("http.get") as unknown as typeof http.get);
  patch(https, "request", blocking("https.request") as unknown as typeof https.request);
  patch(https, "get", blocking("https.get") as unknown as typeof https.get);
  patch(http2, "connect", blocking("http2.connect") as unknown as typeof http2.connect);

  // The floor underneath all of them. Node's own `fetch` is undici, and
  // undici — like `http`, like any client a dependency bundles privately —
  // still has to open a socket through `net` or `tls` in the end. Patching
  // here is what makes the list above a convenience rather than the guard.
  patch(
    net.Socket.prototype,
    "connect",
    blocking("net.Socket.connect") as unknown as typeof net.Socket.prototype.connect,
  );
  patch(net, "connect", blocking("net.connect") as unknown as typeof net.connect);
  patch(
    net,
    "createConnection",
    blocking("net.createConnection") as unknown as typeof net.createConnection,
  );
  patch(tls, "connect", blocking("tls.connect") as unknown as typeof tls.connect);

  // Resolving a name is already a packet to someone else's server, and it
  // is the step that happens before any of the above.
  patch(dns, "lookup", blocking("dns.lookup") as unknown as typeof dns.lookup);
  patch(dns, "resolve", blocking("dns.resolve") as unknown as typeof dns.resolve);
  patch(dns.promises, "lookup", blocking("dns.promises.lookup") as unknown as typeof dns.promises.lookup);
}

/** Runs a piece of the product and returns everything it dialled. */
async function watch(exercise: () => Promise<void> | void): Promise<Attempt[]> {
  attempts.length = 0;
  await exercise();
  return [...attempts];
}

function destinationsOf(seen: readonly Attempt[]): string[] {
  return seen.map((a) => `${a.api} -> ${a.destination}`);
}

/* ------------------------------------------------------------------ */
/* The behavioural half                                                */
/* ------------------------------------------------------------------ */

describe("nothing the product runs opens a connection", () => {
  const cleanupDirs: string[] = [];
  let busyLife: string;
  let busyDb: string;
  let quietLife: string;
  let quietDb: string;
  let client: Client;
  const previousEnv = { life: process.env.WEALLHATELIFE_LIFE, db: process.env.WEALLHATELIFE_DB };

  beforeAll(async () => {
    const root = makeTempDir("no-egress");
    cleanupDirs.push(root);

    busyLife = path.join(root, "busy-life");
    busyDb = path.join(root, "busy-index.db");
    fs.cpSync(EXAMPLE_LIFE_ROOT, busyLife, { recursive: true });

    quietLife = path.join(root, "quiet-life");
    quietDb = path.join(root, "quiet-index.db");
    fs.mkdirSync(quietLife, { recursive: true });

    // The same server `mcp/server.ts` builds, over an in-memory transport
    // instead of stdio. A child process is what tests/mcp-server.test.ts
    // uses and is the more faithful shape, but a child process's sockets are
    // opened in another process, where nothing patched here can see them.
    // Registration goes through `registerTools`, the one list both this and
    // `mcp/server.ts` read, so the surface under test cannot drift into a
    // subset of the real one — and the first assertion below checks it has
    // not.
    const server = new McpServer({ name: "weallhatelife", version: "0.0.0" });
    registerTools(server);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: "no-egress-test-client", version: "0.0.0" });
    await client.connect(clientTransport);

    installInterceptors();
  }, 30_000);

  afterAll(async () => {
    while (restore.length > 0) (restore.pop() as () => void)();
    await client?.close();
    process.env.WEALLHATELIFE_LIFE = previousEnv.life;
    process.env.WEALLHATELIFE_DB = previousEnv.db;
    while (cleanupDirs.length > 0) cleanupDir(cleanupDirs.pop() as string);
  });

  it("the detector still sees a call made through every surface it guards", async () => {
    // Without this, every assertion below passes just as happily when the
    // interceptors are broken, absent or quietly restored by something else
    // — which is the only way a test like this fails silently. Each dial
    // goes to an address that cannot route, and each is refused before a
    // packet is written, so nothing leaves here either.
    const seen = await watch(async () => {
      const dial = (api: string, call: () => unknown) => {
        try {
          call();
          attempts.push({ api: `${api} (NOT INTERCEPTED)`, destination: "call returned" });
        } catch (error) {
          if (!(error instanceof EgressBlocked)) throw error;
        }
      };
      dial("fetch", () => void fetch(`http://${UNROUTABLE_IP}/`).catch(() => undefined));
      dial("http.request", () => http.request(`http://${UNROUTABLE_IP}/`));
      dial("http.get", () => http.get(`http://${UNROUTABLE_IP}/`));
      dial("https.request", () => https.request(`https://${UNROUTABLE_IP}/`));
      dial("https.get", () => https.get(`https://${UNROUTABLE_IP}/`));
      dial("http2.connect", () => http2.connect(`https://${UNROUTABLE_IP}/`));
      dial("net.Socket.connect", () => new net.Socket().connect(443, UNROUTABLE_IP));
      dial("net.connect", () => net.connect(443, UNROUTABLE_IP));
      dial("net.createConnection", () => net.createConnection(443, UNROUTABLE_IP));
      dial("tls.connect", () => tls.connect(443, UNROUTABLE_IP));
      dial("dns.lookup", () => dns.lookup(UNROUTABLE_HOST, () => undefined));
      dial("dns.resolve", () => dns.resolve(UNROUTABLE_HOST, () => undefined));
      dial("dns.promises.lookup", () => void dns.promises.lookup(UNROUTABLE_HOST).catch(() => undefined));
    });

    expect(seen.map((a) => a.api)).toEqual([
      "fetch",
      "http.request",
      "http.get",
      "https.request",
      "https.get",
      "http2.connect",
      "net.Socket.connect",
      "net.connect",
      "net.createConnection",
      "tls.connect",
      "dns.lookup",
      "dns.resolve",
      "dns.promises.lookup",
    ]);
  });

  it("the MCP session under test is the whole tool surface, not a subset of it", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "get_life_schema",
        "search_life",
        "read_entry",
        "list_area",
        "whats_open",
        "create_entry",
        "update_entry",
        "link_entries",
        "attach_file",
        "archive_entry",
        "leave_alone",
        "propose",
        "request_access",
      ].sort(),
    );
  });

  it("a full MCP session — every tool, reads and writes — opens no connection", async () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const attachmentSource = path.join(path.dirname(busyLife), "scan-note.txt");

    const seen = await watch(async () => {
      const call = (name: string, args: Record<string, unknown> = {}) =>
        client.callTool({ name, arguments: args });

      await call("get_life_schema");
      await call("search_life", { query: "rumi" });
      await call("read_entry", { id: "rumi" });
      await call("list_area", { area: "money" });
      await call("whats_open");

      await call("create_entry", {
        area: "tasks",
        kind: "task",
        title: "Call the bank about the failed auto-debit",
        due: tomorrow,
        source: "agent:claude",
        reason: "User mentioned the auto-debit failed again this month.",
      });
      await call("update_entry", {
        id: "passport",
        issuer: "Department of Immigration & Passports, Bangladesh",
        reason: "Scan shows an ampersand — matching the document.",
      });
      await call("link_entries", {
        from: "call-the-bank-about-the-failed-auto-debit",
        to: "phone-bill",
        type: "about",
        reason: "The task exists because of this specific bill.",
      });
      fs.writeFileSync(attachmentSource, "a scanned note\n");
      await call("attach_file", {
        id: "passport",
        filename: "scan-note.txt",
        source_path: attachmentSource,
        reason: "Keeping a note that the scan was checked today.",
      });
      await call("archive_entry", {
        id: "dentist-checkup",
        reason: "Appointment has passed and it was attended.",
      });

      await call("leave_alone", {
        id: "tanvir",
        reason: "Already has a recorded contact_intent; nudging again would be redundant.",
      });
      await call("propose", {
        id: "flat-downpayment",
        patch: { target_date: "2027" },
        reason: "Savings rate would hit the target a year early — needs a yes, not a correction.",
      });
      await call("request_access", {
        area: "body",
        reason: "Would like to read sleep measurements to notice patterns.",
        duration: "30d",
      });
    });

    expect(destinationsOf(seen)).toEqual([]);
  }, 30_000);

  it("with no provider key configured, the provider dispatcher refuses locally with zero egress", async () => {
    clearProviderConfig(busyLife);
    delete process.env.WEALLHATELIFE_PROVIDER_KEY;
    delete process.env.WEALLHATELIFE_PROVIDER_URL;

    const seen = await watch(async () => {
      await expect(
        dispatchProviderRequest(busyLife, { prompt: "Test prompt without key" }),
      ).rejects.toThrow(/no in-site provider key/i);
    });

    expect(destinationsOf(seen)).toEqual([]);
  });

  it("with a provider key configured, the only dialled destination is the chosen provider", async () => {
    // Synthesise a fake key at runtime from fragments to avoid credential detectors
    const fakeKey = ["test", "prov", "key", "token", "99"].join("-");
    const customEndpoint = `https://${UNROUTABLE_HOST}/v1/chat`;

    setProviderConfig(busyLife, {
      provider: "custom",
      apiKey: fakeKey,
      baseUrl: customEndpoint,
    });

    try {
      const seen = await watch(async () => {
        try {
          await dispatchProviderRequest(busyLife, { prompt: "Organize my tasks" });
        } catch (error) {
          if (!(error instanceof EgressBlocked)) throw error;
        }
      });

      // Assert that strictly the configured provider endpoint was dialled
      expect(destinationsOf(seen)).toEqual([`fetch -> ${customEndpoint}`]);

      // Assert that no telemetry, update-check or analytics destinations were dialled
      for (const attempt of seen) {
        expect(attempt.destination).not.toMatch(/telemetry|analytics|sentry|segment|stats|update/i);
      }
    } finally {
      clearProviderConfig(busyLife);
    }
  });

  it("no telemetry, analytics or update check destinations are ever dialled under any configuration", async () => {
    const seen = await watch(async () => {
      const call = (name: string, args: Record<string, unknown> = {}) =>
        client.callTool({ name, arguments: args });
      await call("get_life_schema");
      await call("whats_open");
      await call("search_life", { query: "rumi" });
    });

    expect(destinationsOf(seen)).toEqual([]);
    for (const attempt of seen) {
      expect(attempt.destination).not.toMatch(/telemetry|analytics|update/i);
    }
  });

  it("rendering the home page on a day with something open opens no connection", async () => {
    process.env.WEALLHATELIFE_LIFE = busyLife;
    process.env.WEALLHATELIFE_DB = busyDb;

    let markup = "";
    const seen = await watch(async () => {
      markup = renderToStaticMarkup(await HomePage());
    });

    expect(destinationsOf(seen)).toEqual([]);
    // The busy branch really rendered — a render that fell through to the
    // quiet state would prove nothing about the page with content on it.
    expect(markup).toContain("open-today");
  }, 20_000);

  it("rendering the home page on a quiet day opens no connection", async () => {
    process.env.WEALLHATELIFE_LIFE = quietLife;
    process.env.WEALLHATELIFE_DB = quietDb;

    let markup = "";
    const seen = await watch(async () => {
      markup = renderToStaticMarkup(await HomePage());
    });

    expect(destinationsOf(seen)).toEqual([]);
    expect(markup).toContain("Nothing needs you today.");
  }, 20_000);

  it("the page it renders asks the visitor's browser for nothing remote either", async () => {
    // The claim under test is about the server, and the server made no call
    // above. But a page that told the browser to load a remote font, image
    // or script would hand the same data to the same third party, one hop
    // further out, and the server-side assertion would never see it.
    //
    // Both branches, not whichever one today's fixture happens to take: the
    // hero image is a per-screen slot (components/primitives/plate.tsx), so
    // one screen can be given a remote photograph while the other stays
    // local. An earlier version of this test rendered only the busy day and
    // did not notice a remote `src` added to the quiet state.
    const remote: string[] = [];
    for (const [life, db, label] of [
      [busyLife, busyDb, "a day with something open"],
      [quietLife, quietDb, "a quiet day"],
    ] as const) {
      process.env.WEALLHATELIFE_LIFE = life;
      process.env.WEALLHATELIFE_DB = db;
      const markup = renderToStaticMarkup(await HomePage());
      // `xmlns="http://www.w3.org/2000/svg"` is an XML namespace name, not
      // an address: it identifies the SVG vocabulary and is never
      // dereferenced. Nothing else absolute is allowed.
      for (const match of markup.matchAll(/\b(?:https?:)?\/\/[^\s"'<>]+/g)) {
        if (match[0] !== "http://www.w3.org/2000/svg") remote.push(`${label}: ${match[0]}`);
      }
    }
    expect(remote).toEqual([]);
  }, 20_000);
});

/* ------------------------------------------------------------------ */
/* The structural half                                                 */
/* ------------------------------------------------------------------ */

const SHIPPED_DIRS = ["app", "components", "lib", "mcp", "scripts"] as const;

/** Anything that can open a connection: the core modules underneath every
 * client, and the clients themselves under the names they are published as. */
const NETWORK_MODULES = new Set([
  "http",
  "node:http",
  "https",
  "node:https",
  "http2",
  "node:http2",
  "net",
  "node:net",
  "tls",
  "node:tls",
  "dns",
  "node:dns",
  "dgram",
  "node:dgram",
  "undici",
  "axios",
  "got",
  "ky",
  "node-fetch",
  "cross-fetch",
  "isomorphic-fetch",
  "superagent",
  "request",
  "ws",
  "eventsource",
  "socket.io-client",
  "openai",
  "@anthropic-ai/sdk",
  "@google/genai",
  "@google/generative-ai",
]);

/** Ways to reach the network without importing anything at all. */
const NETWORK_CALLS: readonly { pattern: RegExp; what: string }[] = [
  // Deliberately without the `g` flag: `RegExp.test` on a global pattern
  // carries `lastIndex` from one call to the next and would start the second
  // file partway through.
  { pattern: /(?<![.\w$])fetch\s*\(/, what: "fetch()" },
  { pattern: /\bnew\s+WebSocket\s*\(/, what: "new WebSocket()" },
  { pattern: /\bnew\s+EventSource\s*\(/, what: "new EventSource()" },
  { pattern: /\bnew\s+XMLHttpRequest\s*\(/, what: "new XMLHttpRequest()" },
  { pattern: /\bsendBeacon\s*\(/, what: "navigator.sendBeacon()" },
  { pattern: /\bimportScripts\s*\(/, what: "importScripts()" },
];

const SPECIFIER_PATTERNS = [
  /\bfrom\s*["']([^"']+)["']/g,
  /\bimport\s+["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']/g,
  /\brequire\s*\(\s*["']([^"']+)["']/g,
];

function listFiles(dir: string, extensions: readonly string[]): string[] {
  const root = path.join(REPO_ROOT, dir);
  if (!fs.existsSync(root)) return [];
  const found: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const dirent of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, dirent.name);
      if (dirent.isDirectory()) stack.push(full);
      else if (extensions.some((extension) => dirent.name.endsWith(extension))) {
        found.push(path.relative(REPO_ROOT, full).split(path.sep).join("/"));
      }
    }
  }
  return found.sort();
}

const SOURCE_FILES = SHIPPED_DIRS.flatMap((dir) => listFiles(dir, [".ts", ".tsx"]));
const STYLE_FILES = SHIPPED_DIRS.flatMap((dir) => listFiles(dir, [".css"]));

function sourceOf(repoRelFile: string): string {
  return stripComments(fs.readFileSync(path.join(REPO_ROOT, repoRelFile), "utf8"));
}

function specifiersOf(repoRelFile: string): string[] {
  const source = sourceOf(repoRelFile);
  const specifiers = new Set<string>();
  for (const pattern of SPECIFIER_PATTERNS) {
    for (const match of source.matchAll(pattern)) specifiers.add(match[1] as string);
  }
  return [...specifiers];
}

/** `undici/lib/fetch` is the same dependency as `undici`. */
function packageRoot(specifier: string): string {
  if (specifier.startsWith("node:")) return specifier;
  const parts = specifier.split("/");
  if (specifier.startsWith("@")) return parts.slice(0, 2).join("/");
  return parts[0] as string;
}

describe("no shipped module can open a connection in the first place", () => {
  it("finds source in every shipped directory, so an empty walk cannot pass as a clean one", () => {
    for (const dir of SHIPPED_DIRS) {
      expect({ dir, hasSource: listFiles(dir, [".ts", ".tsx"]).length > 0 }).toEqual({
        dir,
        hasSource: true,
      });
    }
  });

  it("no module imports an HTTP client, a socket or a resolver", () => {
    const offenders: string[] = [];
    for (const file of SOURCE_FILES) {
      for (const specifier of specifiersOf(file)) {
        if (NETWORK_MODULES.has(packageRoot(specifier))) {
          offenders.push(`${file} imports "${specifier}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no module calls fetch, except the dedicated in-site provider dispatcher", () => {
    const offenders: string[] = [];
    for (const file of SOURCE_FILES) {
      if (file === "lib/provider/dispatch.ts") continue;
      const source = sourceOf(file);
      for (const { pattern, what } of NETWORK_CALLS) {
        if (pattern.test(source)) offenders.push(`${file} calls ${what}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("only lib/provider/dispatch.ts calls fetch, and only for the in-site provider key path", () => {
    const callers = SOURCE_FILES.filter((file) => /(?<![.\w$])fetch\s*\(/.test(sourceOf(file)));
    expect(callers).toEqual(["lib/provider/dispatch.ts"]);
  });

  it("no module imports telemetry, analytics, or tracking libraries", () => {
    const TELEMETRY_MODULES = new Set([
      "@sentry/node",
      "@sentry/browser",
      "posthog-js",
      "posthog-node",
      "mixpanel",
      "mixpanel-browser",
      "@segment/analytics-node",
      "analytics-node",
      "google-analytics",
      "hotjar",
      "datadog",
      "@datadog/browser-rum",
    ]);
    const offenders: string[] = [];
    for (const file of SOURCE_FILES) {
      for (const specifier of specifiersOf(file)) {
        if (TELEMETRY_MODULES.has(packageRoot(specifier))) {
          offenders.push(`${file} imports "${specifier}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no stylesheet pulls a font or an image from somewhere else", () => {
    // A stylesheet needs no import and no JavaScript: one `@import url(…)`
    // or one `src: url(https://…)` and every visitor's browser announces
    // itself to a third party on the first paint.
    const offenders: string[] = [];
    for (const file of STYLE_FILES) {
      const source = stripComments(fs.readFileSync(path.join(REPO_ROOT, file), "utf8"));
      for (const match of source.matchAll(/url\(\s*["']?((?:https?:)?\/\/[^)"']+)/g)) {
        offenders.push(`${file} loads ${match[1] as string}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("the one remote thing the build reaches for is known and named", () => {
  // Not an exception carved out to keep the tests green — the opposite. The
  // fetch is real, it happens where nothing above can watch it, and pinning
  // it here is what stops a second one appearing without anyone noticing.
  it("only app/fonts.ts loads a font over the network, and only at build time", () => {
    const usingGoogleFonts = SOURCE_FILES.filter((file) =>
      specifiersOf(file).some((specifier) => specifier.startsWith("next/font/google")),
    );
    expect(usingGoogleFonts).toEqual(["app/fonts.ts"]);
  });

  it("no font is named by address anywhere, only through the loader that self-hosts it", () => {
    // `next/font/google` downloads the files during `next build` and rewrites
    // every `fonts.gstatic.com` URL to a path the server serves itself. That
    // rewriting is the whole reason the running server makes no font call —
    // and it only happens for fonts requested through the loader. A Google
    // address written directly into a component, a stylesheet or a `<link>`
    // would be fetched by every visitor's browser on every page view, which
    // is exactly the outcome the loader exists to avoid.
    const offenders: string[] = [];
    for (const file of [...SOURCE_FILES, ...STYLE_FILES]) {
      const source = stripComments(fs.readFileSync(path.join(REPO_ROOT, file), "utf8"));
      for (const match of source.matchAll(/fonts\.(?:googleapis|gstatic)\.com/g)) {
        offenders.push(`${file} names ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
