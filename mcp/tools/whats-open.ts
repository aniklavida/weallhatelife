// `whats_open` — what genuinely needs a person right now. "Nothing" is a
// first-class answer here, not an empty array a model feels obliged to
// explain away (docs/SPEC.md §8, §13). The actual computation now lives in
// lib/summary/whats-open.ts, shared with the website's home route
// (app/page.tsx) — this file resolves the life's location and formats the
// MCP-facing response around that shared result.
import { recordReadAccess } from "../../lib/access/log";
import { isAreaReadable } from "../../lib/access/policy";
import type { Area } from "../../lib/entry/schema";
import { computeOpenItems } from "../../lib/summary/whats-open";
import { ensureFreshIndex, resolveDbPath, resolveLifeRoot } from "../runtime";

export const name = "whats_open";

export const config = {
  title: "What's open",
  description:
    "What genuinely needs a person right now: tasks, appointments, " +
    "obligations and documents with a due-like date that has passed or is " +
    "coming up soon. Returns an explicit \"nothing needs you\" message " +
    "when there is nothing, which is a normal, expected result — not an " +
    "error and not an empty state to explain away.",
  inputSchema: {},
};

export async function handler() {
  const lifeRoot = resolveLifeRoot();
  const dbPath = ensureFreshIndex(lifeRoot, resolveDbPath());
  const rawItems = computeOpenItems(dbPath);

  // Sealed areas never appear in what's open.
  const items = rawItems.filter((item) => isAreaReadable(lifeRoot, item.area as Area));

  recordReadAccess(lifeRoot, {
    tool: name,
    summary: `Checked what's open (${items.length} item${items.length === 1 ? "" : "s"}).`,
  });

  const body =
    items.length === 0
      ? { open: [], message: "Nothing needs you today." }
      : {
          open: items,
          message: `${items.length} thing${items.length === 1 ? "" : "s"} could use you.`,
        };

  return { content: [{ type: "text" as const, text: JSON.stringify(body, null, 2) }] };
}
