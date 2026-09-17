// `create_entry` — files a new entry of any kind, in any area. One tool for
// all fourteen kinds (docs/SPEC.md §7.1, "why one envelope"): the input
// shape below is a flat, all-optional superset of every kind's fields, and
// the handler keeps only the ones that actually belong to the kind given,
// then hands the result to `writeEntry`, which validates it against the
// same `entrySchema` every other consumer uses (lib/entry/schema.ts) —
// there is exactly one place that decides whether an entry is valid, and
// it is not this file.
//
// `reason` is required and not optional-with-a-convention: it is a real
// field on the zod shape below, so a call without one is rejected before
// anything is written, and the tending line is written from the same value
// that made the write possible.
import { z } from "zod";
import { isAreaWritable } from "../../lib/access/policy";
import { AREAS, KINDS, fieldsForKind, type Area, type Kind } from "../../lib/entry/schema";
import { writeEntry } from "../../lib/entry/write";
import { recordTending } from "../../lib/tending/record";
import { resolveLifeRoot, slugify, uniqueId } from "../runtime";

export const name = "create_entry";

const linkShape = z.object({ type: z.string().min(1), target: z.string().min(1) });

export const config = {
  title: "Create entry",
  description:
    "Files a new entry. Works for every area and kind — pass `area` and " +
    "`kind` and only the fields that kind actually uses; call " +
    "get_life_schema first if unsure which fields a kind takes. `id` is " +
    "optional and generated from the title if omitted. `source` and " +
    "`reason` are both required: source records who is telling this entry " +
    "(\"user\", \"agent:<name>\", or \"import:<what>\"), reason is why you " +
    "are filing it and becomes the tending line a person reads later.",
  inputSchema: {
    id: z.string().optional(),
    area: z.enum(AREAS),
    kind: z.enum(KINDS),
    title: z.string().min(1).max(200),
    body: z.string().optional(),
    occurred_at: z.string().optional(),
    source: z.string().min(1),
    confidence: z.number().min(0).max(1).optional(),
    links: z.array(linkShape).optional(),
    attachments: z.array(z.string()).optional(),

    // Per-kind fields — see docs/SPEC.md §7.2. Irrelevant ones for the
    // chosen `kind` are ignored, not rejected, so an agent does not need a
    // different call shape per kind.
    place: z.string().optional(),
    people: z.array(z.string()).optional(),
    media: z.array(z.string()).optional(),
    mood: z.string().optional(),
    relationship: z.string().optional(),
    last_contact_at: z.string().optional(),
    contact_intent: z.string().optional(),
    open_threads: z.array(z.string()).optional(),
    institution: z.string().optional(),
    account_type: z.string().optional(),
    balance: z.number().optional(),
    balance_as_of: z.string().optional(),
    amount: z.number().optional(),
    cadence: z.string().optional(),
    next_due: z.string().optional(),
    counterparty: z.string().optional(),
    target: z.number().optional(),
    saved: z.number().optional(),
    target_date: z.string().optional(),
    with: z.string().optional(),
    at: z.string().optional(),
    location: z.string().optional(),
    metric: z.string().optional(),
    value: z.number().optional(),
    unit: z.string().optional(),
    taken_at: z.string().optional(),
    doc_kind: z.string().optional(),
    issuer: z.string().optional(),
    identifier_last4: z.string().optional(),
    issued_at: z.string().optional(),
    expires_at: z.string().optional(),
    physical_location: z.string().optional(),
    chose: z.string().optional(),
    rejected: z.array(z.string()).optional(),
    because: z.string().optional(),
    would_change_my_mind: z.string().optional(),
    revisit_after: z.string().optional(),
    note: z.string().optional(),
    due: z.string().optional(),
    state: z.enum(["open", "waiting", "done"]).optional(),
    for_project: z.string().optional(),
    description: z.string().optional(),
    status: z.enum(["active", "paused", "done"]).optional(),
    for_goal: z.string().optional(),

    reason: z
      .string()
      .min(1)
      .describe("Why this is being filed. Required. Becomes the tending line."),
  },
};

export async function handler(args: Record<string, unknown> & { area: Area; kind: Kind; title: string; reason: string }) {
  const lifeRoot = resolveLifeRoot();

  if (!isAreaWritable(lifeRoot, args.area)) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: `Area "${args.area}" is sealed. Use propose to suggest changes in sealed areas.`,
        },
      ],
    };
  }

  const { reason, id: requestedId, ...rest } = args;

  const allowedKeys = new Set(fieldsForKind(args.kind));
  const candidate: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (allowedKeys.has(key) && value !== undefined) candidate[key] = value;
  }
  candidate.id =
    typeof requestedId === "string" && requestedId.length > 0
      ? uniqueId(lifeRoot, requestedId)
      : uniqueId(lifeRoot, slugify(args.title));

  const written = writeEntry(lifeRoot, candidate as never);

  recordTending(lifeRoot, {
    tool: name,
    bucket: "filed",
    entryId: written.entry.id,
    summary: `Filed "${written.entry.title}".`,
    reason,
  });

  const body = { entry: written.entry, relative_path: written.relativePath };
  return { content: [{ type: "text" as const, text: JSON.stringify(body, null, 2) }] };
}
