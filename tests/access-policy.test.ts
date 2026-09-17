// Tests for privacy and access enforcement.
//
// Proves:
// 1. Visibility tiers enforced at the tool boundary — sealed areas return nothing,
//    indistinguishable from the area not existing.
// 2. An expired grant stops working without any further call.
// 3. Revocation mid-session takes effect on the very next tool call.
// 4. The access log records a read, not only a write.
// 5. propose is the only path into a sealed area, and needs the person's yes.
// 6. get_life_schema tells the agent what it may currently read.
// 7. Permanent grants are rejected — all grants expire.
import fs from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readAllAccessLogs } from "../lib/access/log";
import {
  grantAccess,
  parseDuration,
  revokeAccess,
  sealArea,
  unsealArea,
} from "../lib/access/policy";
import { registerTools } from "../mcp/tools/index";
import { cleanupDir, EXAMPLE_LIFE_ROOT, makeTempDir } from "./helpers";

function copyDir(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true });
  fs.cpSync(from, to, { recursive: true });
}

async function callJson(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { type: string; text?: string }[]).find((c) => c.type === "text")
    ?.text;
  const isError = Boolean(result.isError);
  // Error responses here are always a plain sentence, not JSON — only a
  // successful call's payload is meant to be parsed.
  const body = !isError && text ? JSON.parse(text) : undefined;
  return { isError, text, body };
}

describe("enforced access policy and privacy boundaries", () => {
  const cleanupDirs: string[] = [];
  let lifeRoot: string;
  let dbPath: string;
  let emptyLifeRoot: string;
  let emptyDbPath: string;
  let client: Client;
  const previousEnv = { life: process.env.WEALLHATELIFE_LIFE, db: process.env.WEALLHATELIFE_DB };

  beforeAll(async () => {
    const root = makeTempDir("access-policy-tests");
    cleanupDirs.push(root);

    lifeRoot = path.join(root, "life");
    dbPath = path.join(root, "index.db");
    copyDir(EXAMPLE_LIFE_ROOT, lifeRoot);

    emptyLifeRoot = path.join(root, "empty-life");
    emptyDbPath = path.join(root, "empty-index.db");
    fs.mkdirSync(emptyLifeRoot, { recursive: true });

    process.env.WEALLHATELIFE_LIFE = lifeRoot;
    process.env.WEALLHATELIFE_DB = dbPath;

    const server = new McpServer({ name: "weallhatelife", version: "0.0.0" });
    registerTools(server);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: "privacy-test-client", version: "0.0.0" });
    await client.connect(clientTransport);
  }, 30_000);

  afterAll(async () => {
    await client?.close();
    process.env.WEALLHATELIFE_LIFE = previousEnv.life;
    process.env.WEALLHATELIFE_DB = previousEnv.db;
    while (cleanupDirs.length > 0) cleanupDir(cleanupDirs.pop() as string);
  });

  beforeEach(() => {
    // Reset policy for lifeRoot to unsealed
    unsealArea(lifeRoot, "body");
    unsealArea(lifeRoot, "money");
    process.env.WEALLHATELIFE_LIFE = lifeRoot;
    process.env.WEALLHATELIFE_DB = dbPath;
  });

  it("a sealed area returns nothing, and the response is indistinguishable from the area not existing", async () => {
    // Part 1: list_area comparison
    // In lifeRoot, seal "body" (which contains real entries: dentist-checkup, sleep-2026-09-10).
    sealArea(lifeRoot, "body");
    const sealedList = await callJson(client, "list_area", { area: "body" });

    // In emptyLife, "body" is not sealed, but has zero entries.
    process.env.WEALLHATELIFE_LIFE = emptyLifeRoot;
    process.env.WEALLHATELIFE_DB = emptyDbPath;
    const emptyList = await callJson(client, "list_area", { area: "body" });

    // Switch back to lifeRoot
    process.env.WEALLHATELIFE_LIFE = lifeRoot;
    process.env.WEALLHATELIFE_DB = dbPath;

    // Both responses must be identical: { area: "body", count: 0, entries: [] }
    expect(sealedList.isError).toBe(false);
    expect(sealedList.body).toEqual({
      area: "body",
      count: 0,
      entries: [],
    });
    expect(sealedList.body).toEqual(emptyList.body);

    // Part 2: read_entry comparison
    // In lifeRoot with "body" sealed, reading "dentist-checkup" (which exists on disk).
    const sealedRead = await callJson(client, "read_entry", { id: "dentist-checkup" });
    // Reading an entry id that truly does not exist on disk anywhere.
    const nonExistentRead = await callJson(client, "read_entry", { id: "completely-non-existent-entry-id" });

    expect(sealedRead.isError).toBe(true);
    expect(nonExistentRead.isError).toBe(true);
    expect(sealedRead.text).toBe(`No entry with id "dentist-checkup" exists.`);
    expect(nonExistentRead.text).toBe(`No entry with id "completely-non-existent-entry-id" exists.`);

    // Part 3: search_life comparison
    const sealedSearch = await callJson(client, "search_life", { query: "dentist", area: "body" });
    const emptySearch = await callJson(client, "search_life", { query: "dentist", area: "habits" }); // no hits

    expect(sealedSearch.body).toEqual({
      query: "dentist",
      count: 0,
      results: [],
    });
    expect(sealedSearch.body.count).toBe(emptySearch.body.count);
    expect(sealedSearch.body.results).toEqual(emptySearch.body.results);
  });

  it("an expired grant stops working without any further call", async () => {
    sealArea(lifeRoot, "body");

    // Initially sealed: cannot read
    const before = await callJson(client, "read_entry", { id: "dentist-checkup" });
    expect(before.isError).toBe(true);

    // Grant temporary access with a duration of 50ms, granted 100ms in the past (already expired)
    grantAccess(lifeRoot, {
      area: "body",
      duration: "50ms",
      reason: "Inspect past dental record",
      grantedAt: new Date(Date.now() - 100).toISOString(),
    });

    // Without any revocation or intervention, reading fails immediately because the grant expired
    const expiredRead = await callJson(client, "read_entry", { id: "dentist-checkup" });
    expect(expiredRead.isError).toBe(true);
    expect(expiredRead.text).toBe(`No entry with id "dentist-checkup" exists.`);

    const expiredList = await callJson(client, "list_area", { area: "body" });
    expect(expiredList.body).toEqual({ area: "body", count: 0, entries: [] });
  });

  it("revocation mid-session takes effect on the very next tool call", async () => {
    sealArea(lifeRoot, "body");

    // Grant 30 days of access
    grantAccess(lifeRoot, {
      area: "body",
      duration: "30d",
      reason: "Active tracking session",
    });

    // Tool call 1: Read succeeds while grant is active
    const activeRead = await callJson(client, "read_entry", { id: "dentist-checkup" });
    expect(activeRead.isError).toBe(false);
    expect(activeRead.body.entry.id).toBe("dentist-checkup");

    // User revokes access mid-session without restarting or reconnecting the client
    revokeAccess(lifeRoot, "body");

    // Tool call 2 (immediate next call on same client): Read fails immediately
    const revokedRead = await callJson(client, "read_entry", { id: "dentist-checkup" });
    expect(revokedRead.isError).toBe(true);
    expect(revokedRead.text).toBe(`No entry with id "dentist-checkup" exists.`);

    // Tool call 3: list_area returns 0 entries
    const revokedList = await callJson(client, "list_area", { area: "body" });
    expect(revokedList.body).toEqual({ area: "body", count: 0, entries: [] });
  });

  it("the access log records a read, not only a write", async () => {
    // Clear any past access logs for test isolation
    const logDir = path.join(lifeRoot, "tended", "access-log");
    if (fs.existsSync(logDir)) fs.rmSync(logDir, { recursive: true });

    // Perform a read tool call
    const read = await callJson(client, "read_entry", { id: "rumi" });
    expect(read.isError).toBe(false);

    // Perform a list tool call
    const list = await callJson(client, "list_area", { area: "people" });
    expect(list.isError).toBe(false);

    // Read back the access log
    const logs = readAllAccessLogs(lifeRoot);
    expect(logs.length).toBeGreaterThanOrEqual(2);

    const readEntryLog = logs.find((l) => l.tool === "read_entry" && l.entryId === "rumi");
    expect(readEntryLog).toBeDefined();
    expect(readEntryLog?.area).toBe("people");
    expect(readEntryLog?.summary).toContain("Rumi");

    const listAreaLog = logs.find((l) => l.tool === "list_area" && l.area === "people");
    expect(listAreaLog).toBeDefined();

    // Verify the physical markdown file on disk
    const today = new Date().toISOString().slice(0, 10);
    const logFilePath = path.join(lifeRoot, "tended", "access-log", `${today}.md`);
    expect(fs.existsSync(logFilePath)).toBe(true);
    const content = fs.readFileSync(logFilePath, "utf8");
    expect(content).toContain("# Access log —");
    expect(content).toContain("`read_entry`");
  });

  it("propose is the only path into a sealed area, and it needs the person's yes", async () => {
    sealArea(lifeRoot, "body");

    // All direct write tools into the sealed area are rejected
    const create = await callJson(client, "create_entry", {
      area: "body",
      kind: "measurement",
      title: "New Weight Reading",
      metric: "weight",
      value: 70,
      unit: "kg",
      taken_at: "2026-09-18",
      source: "agent:claude",
      reason: "Trying to write to sealed area directly",
    });
    expect(create.isError).toBe(true);
    expect(create.text).toMatch(/sealed.*propose/i);

    const update = await callJson(client, "update_entry", {
      id: "dentist-checkup",
      location: "New Dental Clinic",
      reason: "Trying to update sealed entry",
    });
    expect(update.isError).toBe(true);
    expect(update.text).toBe(`No entry with id "dentist-checkup" exists.`);

    const archive = await callJson(client, "archive_entry", {
      id: "dentist-checkup",
      reason: "Trying to archive sealed entry",
    });
    expect(archive.isError).toBe(true);
    expect(archive.text).toBe(`No entry with id "dentist-checkup" exists.`);

    const leaveAlone = await callJson(client, "leave_alone", {
      id: "dentist-checkup",
      reason: "Trying to leave alone sealed entry",
    });
    expect(leaveAlone.isError).toBe(true);
    expect(leaveAlone.text).toBe(`No entry with id "dentist-checkup" exists.`);

    // Propose is accepted and writes a pending proposal file without touching the entry
    const proposed = await callJson(client, "propose", {
      id: "dentist-checkup",
      patch: { location: "New Dental Clinic" },
      reason: "Doctor moved to a new clinic — needs approval.",
    });

    expect(proposed.isError).toBe(false);
    expect(proposed.body.status).toBe("pending");
    expect(fs.existsSync(path.join(lifeRoot, proposed.body.relative_path))).toBe(true);
  });

  it("get_life_schema tells an agent what it is currently allowed to read", async () => {
    sealArea(lifeRoot, "money");

    const { body } = await callJson(client, "get_life_schema");
    expect(body.access.enforced).toBe(true);
    expect(body.access.readable_areas).not.toContain("money");
    expect(body.access.sealed_areas).toContain("money");

    // Grant temporary access to money
    grantAccess(lifeRoot, {
      area: "money",
      duration: "7d",
      reason: "Budget calculation",
    });

    const { body: afterGrant } = await callJson(client, "get_life_schema");
    expect(afterGrant.access.readable_areas).toContain("money");
    expect(afterGrant.access.sealed_areas).not.toContain("money");
    expect(afterGrant.access.grants.money).toBeDefined();
    expect(afterGrant.access.grants.money.duration).toBe("7d");
  });

  it("permanent grants are rejected — all grants must expire", async () => {
    expect(() => parseDuration("indefinite")).toThrow(/must expire/i);
    expect(() => parseDuration("permanent")).toThrow(/must expire/i);
    expect(() => parseDuration("forever")).toThrow(/must expire/i);

    // request_access with indefinite is refused
    const res = await callJson(client, "request_access", {
      area: "body",
      duration: "indefinite",
      reason: "Need permanent access",
    });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/must expire/i);
  });
});
