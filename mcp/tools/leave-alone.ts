// `leave_alone` — restraint, recorded. Not a no-op: the single most
// reassuring thing this product can say is "I looked at this and decided
// not to touch it" (docs/SPEC.md §8, "`leave_alone` is a tool, not a
// no-op"), and that sentence does not exist unless something writes it
// down. This tool changes nothing about the entry itself — it only
// requires that the entry exist, so an agent cannot claim restraint over
// something that was never there — and writes a "left_alone" tending line
// from the reason.
import { z } from "zod";
import { isAreaReadable } from "../../lib/access/policy";
import { readEntry } from "../../lib/entry/read";
import { recordTending } from "../../lib/tending/record";
import { resolveLifeRoot } from "../runtime";

export const name = "leave_alone";

export const config = {
  title: "Leave alone",
  description:
    "Records that the agent looked at this entry and deliberately changed " +
    "nothing. Writes no field on the entry — only a tending line, from the " +
    "required reason. Use this instead of silence whenever you considered " +
    "acting and chose not to; an agent that only ever shows its edits looks " +
    "like one that never restrains itself.",
  inputSchema: {
    id: z.string().min(1),
    reason: z.string().min(1),
  },
};

export async function handler(args: { id: string; reason: string }) {
  const lifeRoot = resolveLifeRoot();
  const existing = readEntry(lifeRoot, args.id);
  if (!existing || !isAreaReadable(lifeRoot, existing.entry.area)) {
    return {
      isError: true,
      content: [{ type: "text" as const, text: `No entry with id "${args.id}" exists.` }],
    };
  }

  recordTending(lifeRoot, {
    tool: name,
    bucket: "left_alone",
    entryId: existing.entry.id,
    summary: `Left "${existing.entry.title}" alone.`,
    reason: args.reason,
  });

  const body = {
    entry_id: existing.entry.id,
    message: `Recorded: left "${existing.entry.title}" alone.`,
  };
  return { content: [{ type: "text" as const, text: JSON.stringify(body, null, 2) }] };
}
