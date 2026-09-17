// The MCP server, exercised through a real MCP client — the same
// Client/StdioClientTransport pair a real agent uses, spawning the actual
// `mcp/server.ts` as a child process against a disposable copy of
// examples/sample-life. Nothing here calls a tool's handler function
// directly; every assertion goes through the wire protocol, the same as
// docs/ROADMAP.md step 2's "done" line asks for: "a real agent — not a
// test harness — connects."
import fs from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readEntry } from "../lib/entry/read";
import { readTendingForDate } from "../lib/tending/record";
import { undoTendingRecord } from "../lib/tending/undo";
import { cleanupDir, EXAMPLE_LIFE_ROOT, makeTempDir } from "./helpers";

const REPO_ROOT = path.resolve(__dirname, "..");

function copyDir(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true });
  fs.cpSync(from, to, { recursive: true });
}

function isoDate(daysFromNow: number): string {
  const d = new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
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

describe("the MCP server, over a real client", () => {
  let lifeRoot: string;
  let dbPath: string;
  let client: Client;
  const cleanupDirs: string[] = [];

  beforeAll(async () => {
    const root = makeTempDir("mcp-server");
    cleanupDirs.push(root);
    lifeRoot = path.join(root, "life");
    dbPath = path.join(root, "index.db");
    copyDir(EXAMPLE_LIFE_ROOT, lifeRoot);

    const transport = new StdioClientTransport({
      command: "npx",
      args: ["tsx", path.join(REPO_ROOT, "mcp/server.ts")],
      cwd: REPO_ROOT,
      env: { ...(process.env as Record<string, string>), WEALLHATELIFE_LIFE: lifeRoot, WEALLHATELIFE_DB: dbPath },
    });
    client = new Client({ name: "test-client", version: "0.0.0" });
    await client.connect(transport);
  }, 30_000);

  afterAll(async () => {
    await client?.close();
    while (cleanupDirs.length > 0) cleanupDir(cleanupDirs.pop() as string);
  });

  it("lists exactly the thirteen tools the spec calls for", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
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

  it("get_life_schema states that access is enforced and lists readable areas", async () => {
    const { body } = await callJson(client, "get_life_schema");
    expect(body.areas).toContain("money");
    expect(body.access.enforced).toBe(true);
    expect(body.access.readable_areas).toContain("money");
  });

  it("search_life finds a person by name in her own entry and in a memory about her", async () => {
    const { body } = await callJson(client, "search_life", { query: "rumi" });
    const ids = body.results.map((r: { id: string }) => r.id).sort();
    expect(ids).toEqual(["coffee-with-rumi", "rumi"]);
  });

  it("read_entry resolves an incoming link that only the other file declared", async () => {
    const { body } = await callJson(client, "read_entry", { id: "rumi" });
    expect(body.links).toEqual([
      expect.objectContaining({ id: "coffee-with-rumi", direction: "incoming" }),
    ]);
  });

  it("list_area returns every money entry, correctly typed per kind", async () => {
    const { body } = await callJson(client, "list_area", { area: "money" });
    expect(body.count).toBe(3);
    const byId = Object.fromEntries(body.entries.map((e: { id: string; kind: string }) => [e.id, e.kind]));
    expect(byId).toEqual({
      "city-bank-savings": "account",
      "flat-downpayment": "saving_goal",
      "phone-bill": "obligation",
    });
  });

  it("list_area works identically for an area with no per-area special casing anywhere, including the newest kind", async () => {
    const { body } = await callJson(client, "list_area", { area: "habits" });
    expect(body.count).toBe(1);
    expect(body.entries[0]).toMatchObject({ id: "morning-walk", kind: "habit" });
  });

  it("create_entry works for the area kind through the same generic tool every other kind uses", async () => {
    const { isError, body } = await callJson(client, "create_entry", {
      area: "areas",
      kind: "area",
      title: "Money",
      description: "The accounts, the obligations, the saving goals — kept together on purpose.",
      body: "Grouping these under one area was Rumi's suggestion, actually.",
      source: "agent:claude",
      reason: "User asked for a broad area to group the money-related entries under.",
    });
    expect(isError).toBe(false);
    expect(body.entry.kind).toBe("area");
    expect(body.entry.description).toContain("kept together on purpose");

    const { body: listed } = await callJson(client, "list_area", { area: "areas" });
    const ids = listed.entries.map((e: { id: string }) => e.id).sort();
    expect(ids).toEqual(["family", "health", "home", "money"]);

    // The body is indexed the same way any other kind's body is — no
    // per-kind carve-out in the search path either.
    const { body: found } = await callJson(client, "search_life", { query: "suggestion" });
    expect(found.results.map((r: { id: string }) => r.id)).toContain("money");
  });

  it("every write tool refuses a call with no reason — an agent that writes without a reason cannot write at all", async () => {
    const casesMissingReason: { name: string; args: Record<string, unknown> }[] = [
      { name: "create_entry", args: { area: "someday", kind: "someday", title: "No reason", source: "user" } },
      { name: "update_entry", args: { id: "rumi", title: "Rumi" } },
      { name: "archive_entry", args: { id: "rumi" } },
      { name: "leave_alone", args: { id: "rumi" } },
      { name: "link_entries", args: { from: "rumi", to: "nani", type: "mentions" } },
      { name: "attach_file", args: { id: "rumi", filename: "note.txt", source_path: __filename } },
      { name: "propose", args: { id: "rumi", patch: { title: "Rumi" } } },
      { name: "request_access", args: { area: "body" } },
    ];
    for (const { name: toolName, args } of casesMissingReason) {
      const { isError, text } = await callJson(client, toolName, args);
      expect({ toolName, isError }).toEqual({ toolName, isError: true });
      expect(text ?? "").toMatch(/reason/i);
    }
  });

  it("create_entry refuses a call with no reason before the handler ever runs", async () => {
    const { isError, text } = await callJson(client, "create_entry", {
      area: "someday",
      kind: "someday",
      title: "No reason given",
      source: "user",
    });
    expect(isError).toBe(true);
    expect(text).toMatch(/reason/i);
  });

  it("create_entry files a new entry and writes a legible, reason-carrying tending line", async () => {
    const { isError, body } = await callJson(client, "create_entry", {
      area: "tasks",
      kind: "task",
      title: "Call the bank about the failed auto-debit",
      due: isoDate(1),
      source: "agent:claude",
      reason: "User mentioned in chat that the auto-debit failed again this month.",
    });
    expect(isError).toBe(false);
    expect(body.entry.id).toBe("call-the-bank-about-the-failed-auto-debit");
    expect(body.entry.state).toBe("open");

    const today = new Date().toISOString().slice(0, 10);
    const records = readTendingForDate(lifeRoot, today);
    const record = records.find(
      (r) => r.tool === "create_entry" && r.entryId === "call-the-bank-about-the-failed-auto-debit",
    );
    expect(record).toMatchObject({
      bucket: "filed",
      entryId: "call-the-bank-about-the-failed-auto-debit",
      reason: "User mentioned in chat that the auto-debit failed again this month.",
    });

    // Legible without any tool — the same claim tests/tending.test.ts makes,
    // checked here against what the server actually wrote.
    const raw = fs.readFileSync(path.join(lifeRoot, "tended", `${today}.md`), "utf8");
    expect(raw).toContain("Filed:");
    expect(raw).toContain("auto-debit failed again");
  });

  it("whats_open says nothing needs you when nothing is due soon, and something once it is", async () => {
    const root = makeTempDir("whats-open");
    cleanupDirs.push(root);
    const soloLife = path.join(root, "life");
    const soloDb = path.join(root, "index.db");
    fs.mkdirSync(soloLife, { recursive: true });

    const transport = new StdioClientTransport({
      command: "npx",
      args: ["tsx", path.join(REPO_ROOT, "mcp/server.ts")],
      cwd: REPO_ROOT,
      env: { ...(process.env as Record<string, string>), WEALLHATELIFE_LIFE: soloLife, WEALLHATELIFE_DB: soloDb },
    });
    const solo = new Client({ name: "test-client-solo", version: "0.0.0" });
    await solo.connect(transport);

    try {
      const empty = await callJson(solo, "whats_open");
      expect(empty.body).toEqual({ open: [], message: "Nothing needs you today." });

      await callJson(solo, "create_entry", {
        area: "tasks",
        kind: "task",
        title: "Renew the parking permit",
        due: isoDate(1),
        source: "user",
        reason: "Filing directly for the test.",
      });
      await callJson(solo, "create_entry", {
        area: "tasks",
        kind: "task",
        title: "Something for way later",
        due: isoDate(200),
        source: "user",
        reason: "Filing directly for the test.",
      });

      const withOne = await callJson(solo, "whats_open");
      expect(withOne.body.open).toHaveLength(1);
      expect(withOne.body.open[0].id).toBe("renew-the-parking-permit");
      expect(withOne.body.message).toBe("1 thing could use you.");
    } finally {
      await solo.close();
    }
  }, 20_000);

  it("archive_entry sets archived_at without deleting the file, and the entry is still readable", async () => {
    const { body } = await callJson(client, "archive_entry", {
      id: "dentist-checkup",
      reason: "Appointment date has passed and it was attended.",
    });
    expect(body.entry.archived_at).toBeTruthy();
    expect(fs.existsSync(path.join(lifeRoot, body.relative_path))).toBe(true);

    const read = await callJson(client, "read_entry", { id: "dentist-checkup" });
    expect(read.body.entry.archived_at).toBeTruthy();
  });

  it("link_entries records an edge that resolves from the other side too", async () => {
    await callJson(client, "link_entries", {
      from: "call-the-bank-about-the-failed-auto-debit",
      to: "phone-bill",
      type: "about",
      reason: "The task exists because of this specific bill.",
    });
    const { body } = await callJson(client, "read_entry", { id: "phone-bill" });
    expect(body.links).toEqual([
      expect.objectContaining({ id: "call-the-bank-about-the-failed-auto-debit", direction: "incoming" }),
    ]);
  });

  it("update_entry refuses to change id, area, kind or archived_at", async () => {
    const { isError, body } = await callJson(client, "update_entry", {
      id: "passport",
      area: "money",
      reason: "trying to re-type the entry",
    });
    expect(isError).toBe(true);
    expect(body).toBeUndefined();
  });

  it("update_entry corrects a field and writes a corrected tending line", async () => {
    const { body } = await callJson(client, "update_entry", {
      id: "passport",
      issuer: "Department of Immigration & Passports, Bangladesh",
      reason: "Scan shows an ampersand, not \"and\" — fixing to match.",
    });
    expect(body.entry.issuer).toBe("Department of Immigration & Passports, Bangladesh");

    const today = new Date().toISOString().slice(0, 10);
    const records = readTendingForDate(lifeRoot, today);
    expect(records.some((r) => r.tool === "update_entry" && r.bucket === "corrected")).toBe(true);
  });

  it("update_entry captures the previous value on the tending line, and a real undo restores it exactly", async () => {
    const before = readEntry(lifeRoot, "city-bank-savings");
    const previousBalance = (before?.entry as { balance?: number } | undefined)?.balance;
    expect(previousBalance).toBeTypeOf("number");

    await callJson(client, "update_entry", {
      id: "city-bank-savings",
      balance: 999999,
      balance_as_of: "2026-09-14",
      reason: "Statement corrected the September figure.",
    });

    const today = new Date().toISOString().slice(0, 10);
    const records = readTendingForDate(lifeRoot, today);
    const record = records.find(
      (r) => r.tool === "update_entry" && r.bucket === "corrected" && r.entryId === "city-bank-savings",
    );
    expect(record?.revert).toMatchObject({ balance: previousBalance });

    expect(record).toBeTruthy();
    const undone = undoTendingRecord(lifeRoot, record!.relativePath, record!.at);
    expect(undone.ok).toBe(true);

    const after = readEntry(lifeRoot, "city-bank-savings");
    expect((after?.entry as { balance?: number } | undefined)?.balance).toBe(previousBalance);
  });

  it("leave_alone writes only a tending line and never touches the entry file", async () => {
    const before = fs.readFileSync(path.join(lifeRoot, "people", "tanvir.md"), "utf8");
    const { body } = await callJson(client, "leave_alone", {
      id: "tanvir",
      reason: "Already has a recorded contact_intent; nudging again would be redundant.",
    });
    expect(body.entry_id).toBe("tanvir");
    const after = fs.readFileSync(path.join(lifeRoot, "people", "tanvir.md"), "utf8");
    expect(after).toBe(before);

    const today = new Date().toISOString().slice(0, 10);
    const records = readTendingForDate(lifeRoot, today);
    expect(records.some((r) => r.tool === "leave_alone" && r.bucket === "left_alone")).toBe(true);
  });

  it("leave_alone errors on an id that does not exist, rather than recording it anyway", async () => {
    const { isError } = await callJson(client, "leave_alone", {
      id: "does-not-exist",
      reason: "testing the error path",
    });
    expect(isError).toBe(true);
  });

  it("propose writes a pending file and never touches the target entry", async () => {
    const before = fs.readFileSync(path.join(lifeRoot, "money", "goals", "flat-downpayment.md"), "utf8");
    const { body } = await callJson(client, "propose", {
      id: "flat-downpayment",
      patch: { target_date: "2027" },
      reason: "Savings rate would hit the target a year early — needs a yes, not a correction.",
    });
    expect(body.status).toBe("pending");
    const after = fs.readFileSync(path.join(lifeRoot, "money", "goals", "flat-downpayment.md"), "utf8");
    expect(after).toBe(before);
    expect(fs.existsSync(path.join(lifeRoot, body.relative_path))).toBe(true);
  });

  it("request_access records the ask with duration and reports status", async () => {
    const { body } = await callJson(client, "request_access", {
      area: "body",
      reason: "Would like to read sleep measurements to notice patterns.",
      duration: "30d",
    });
    expect(fs.existsSync(path.join(lifeRoot, body.relative_path))).toBe(true);
    expect(body.duration).toBe("30d");
    expect(body.granted).toBe(true);
    expect(body.note).toContain("already readable");
  });

  it("attach_file copies bytes beside the entry and adds it to attachments", async () => {
    const tmp = path.join(path.dirname(lifeRoot), "note.txt");
    fs.writeFileSync(tmp, "a scanned note\n");
    const { body } = await callJson(client, "attach_file", {
      id: "passport",
      filename: "scan-note.txt",
      source_path: tmp,
      reason: "Keeping a note that the scan was checked today.",
    });
    expect(body.entry.attachments).toContain("scan-note.txt");
    expect(fs.readFileSync(path.join(lifeRoot, "papers", "scan-note.txt"), "utf8")).toBe("a scanned note\n");
  });
});
