// `link_entries` — add or remove a typed edge (docs/SPEC.md §7.3, §8). The
// edge is written only on the `from` side, on disk — the reverse direction
// is the index's job to compute (lib/index/links.ts), never a second write
// to the target's file. Both directions still exist as ids in this life
// (existence of `from` is required; `to` is not required to already exist,
// the same way the file-format layer allows it, so a link can point at
// something an agent is about to file next).
import { z } from "zod";
import { isAreaReadable } from "../../lib/access/policy";
import { readEntry } from "../../lib/entry/read";
import { writeEntry } from "../../lib/entry/write";
import { recordTending } from "../../lib/tending/record";
import { resolveLifeRoot } from "../runtime";

export const name = "link_entries";

export const config = {
  title: "Link entries",
  description:
    "Adds or removes a typed edge from one entry to another, e.g. " +
    "{ from: 'coffee-with-rumi', type: 'about', to: 'rumi' }. The edge is " +
    "only ever recorded on the `from` side; it resolves back from `to` " +
    "automatically. Requires a reason.",
  inputSchema: {
    from: z.string().min(1),
    to: z.string().min(1),
    type: z.string().min(1).max(60),
    action: z.enum(["add", "remove"]).default("add").optional(),
    reason: z.string().min(1),
  },
};

export async function handler(args: {
  from: string;
  to: string;
  type: string;
  action?: "add" | "remove";
  reason: string;
}) {
  const lifeRoot = resolveLifeRoot();
  const existing = readEntry(lifeRoot, args.from);
  if (!existing || !isAreaReadable(lifeRoot, existing.entry.area)) {
    return {
      isError: true,
      content: [{ type: "text" as const, text: `No entry with id "${args.from}" exists.` }],
    };
  }

  const toExisting = readEntry(lifeRoot, args.to);
  if (toExisting && !isAreaReadable(lifeRoot, toExisting.entry.area)) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: `Cannot link to entry in sealed area "${toExisting.entry.area}". Use propose to suggest links to sealed entries.`,
        },
      ],
    };
  }

  const action = args.action ?? "add";
  const links = existing.entry.links.filter(
    (link) => !(link.type === args.type && link.target === args.to),
  );
  if (action === "add") links.push({ type: args.type, target: args.to });

  const written = writeEntry(lifeRoot, { ...existing.entry, links } as never);

  const verb = action === "add" ? "Linked" : "Unlinked";
  recordTending(lifeRoot, {
    tool: name,
    bucket: action === "add" ? "filed" : "corrected",
    entryId: written.entry.id,
    summary: `${verb} "${written.entry.title}" ${action === "add" ? "to" : "from"} "${args.to}" (${args.type}).`,
    reason: args.reason,
  });

  const body = { entry: written.entry };
  return { content: [{ type: "text" as const, text: JSON.stringify(body, null, 2) }] };
}
