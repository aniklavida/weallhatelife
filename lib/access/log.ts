// The access log — an append-only, human-readable record of what the agent
// read and when, not only what it wrote.
//
// One markdown file per day in `tended/access-log/YYYY-MM-DD.md`, legible
// in any text editor. Each line also carries an HTML comment with structured
// JSON payload so programmatic readers can parse it without guessing.
import fs from "node:fs";
import path from "node:path";
import type { Area } from "../entry/schema";

export interface ReadAccessRecord {
  /** ISO 8601 timestamp. Generated if omitted. */
  at?: string;
  /** The MCP tool that performed the read, e.g. "read_entry". */
  tool: string;
  /** The area read, if applicable. */
  area?: Area;
  /** The specific entry read, if applicable. */
  entryId?: string;
  /** Human-readable description of what was read. */
  summary: string;
}

export interface WrittenReadAccessRecord extends Required<Omit<ReadAccessRecord, "area" | "entryId">> {
  area?: Area;
  entryId?: string;
  relativePath: string;
}

function dateFragment(iso: string): string {
  return iso.slice(0, 10); // "2026-09-18T00:00:00.000Z" -> "2026-09-18"
}

function timeFragment(iso: string): string {
  return iso.slice(11, 16); // "…T09:14:00.000Z" -> "09:14"
}

function oneLine(value: string): string {
  return value.replace(/\s*\n\s*/g, " ").trim();
}

const ACCESS_LOG_DIR = path.join("tended", "access-log");

/**
 * Appends one entry to today's access log file.
 * Creates the day's file and heading if it does not yet exist.
 */
export function recordReadAccess(lifeRoot: string, record: ReadAccessRecord): WrittenReadAccessRecord {
  const at = record.at ?? new Date().toISOString();
  const summary = oneLine(record.summary);
  const relativePath = path.join(ACCESS_LOG_DIR, `${dateFragment(at)}.md`);
  const filePath = path.join(lifeRoot, relativePath);

  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const isNew = !fs.existsSync(filePath);
  const heading = isNew ? `# Access log — ${dateFragment(at)}\n\n` : "";

  const areaFragment = record.area ? ` [${record.area}]` : "";
  const entryFragment = record.entryId ? ` \`${record.entryId}\`` : "";
  const payload = JSON.stringify({
    at,
    tool: record.tool,
    area: record.area,
    entryId: record.entryId,
    summary,
  });

  const line = `- **${timeFragment(at)}** — Read${areaFragment}:${entryFragment} ${summary} _(via \`${record.tool}\`)_\n  <!-- access: ${payload} -->\n`;

  fs.appendFileSync(filePath, heading + line, "utf8");

  return {
    at,
    tool: record.tool,
    area: record.area,
    entryId: record.entryId,
    summary,
    relativePath,
  };
}

const ACCESS_LINE_PATTERN = /<!-- access: (.+) -->/g;

/** Parses all read access records from one day's log file. */
export function readAccessLogForDate(lifeRoot: string, date: string): WrittenReadAccessRecord[] {
  const relativePath = path.join(ACCESS_LOG_DIR, `${date}.md`);
  const filePath = path.join(lifeRoot, relativePath);
  if (!fs.existsSync(filePath)) return [];

  const raw = fs.readFileSync(filePath, "utf8");
  const records: WrittenReadAccessRecord[] = [];
  for (const match of raw.matchAll(ACCESS_LINE_PATTERN)) {
    const payload = match[1];
    if (!payload) continue;
    try {
      const parsed = JSON.parse(payload) as {
        at: string;
        tool: string;
        area?: Area;
        entryId?: string;
        summary: string;
      };
      records.push({
        ...parsed,
        relativePath,
      });
    } catch {
      // Ignore corrupted lines
    }
  }
  return records;
}

/** Lists all dates (YYYY-MM-DD) that have an access log file, sorted newest first. */
export function accessLogDates(lifeRoot: string): string[] {
  const logDir = path.join(lifeRoot, ACCESS_LOG_DIR);
  if (!fs.existsSync(logDir)) return [];
  return fs
    .readdirSync(logDir)
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name))
    .map((name) => name.slice(0, 10))
    .sort()
    .reverse();
}

/** Reads all recorded read access records across all dates, newest first. */
export function readAllAccessLogs(lifeRoot: string): WrittenReadAccessRecord[] {
  const dates = accessLogDates(lifeRoot);
  const records = dates.flatMap((date) => readAccessLogForDate(lifeRoot, date));
  records.sort((a, b) => b.at.localeCompare(a.at));
  return records;
}

/** Reads the most recent access records up to `limit`, newest first. */
export function readRecentAccessLogs(lifeRoot: string, limit = 20): WrittenReadAccessRecord[] {
  return readAllAccessLogs(lifeRoot).slice(0, limit);
}
