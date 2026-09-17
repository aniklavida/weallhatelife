// `update_entry` — a patch and a required reason (docs/SPEC.md §8). This is
// the "corrected" half of the tending panel: every call here writes a
// "corrected" line, because a plain field fix is exactly what that bucket
// is for. Changing `area`, `kind` or `id` is refused — those define which
// entry this is, and re-typing an entry is not a correction, it is a new
// entry plus an archive. `archived_at` is refused too: that is
// `archive_entry`'s job, so there is exactly one path that can make an
// entry disappear from view, and it always carries its own reason.
import { z } from "zod";
import { isAreaReadable } from "../../lib/access/policy";
import { AREAS, KINDS, fieldsForKind, type Kind } from "../../lib/entry/schema";
import { readEntry } from "../../lib/entry/read";
import { writeEntry } from "../../lib/entry/write";
import { recordTending } from "../../lib/tending/record";
import { resolveLifeRoot } from "../runtime";
import { config as createEntryConfig } from "./create-entry";

export const name = "update_entry";

const FORBIDDEN_PATCH_KEYS = new Set(["id", "area", "kind", "archived_at", "created_at"]);

// Same field surface as create_entry. Re-describing the same shape here
// would drift from create-entry.ts the first time either one is edited, so
// this reuses it wholesale — but `area`, `kind`, `title` and `source` are
// all *required* there (a new entry needs all four) and must become
// optional here, since a patch only names what it is actually changing.
// `area` and `kind` stay *declared*, rather than stripped from the schema
// entirely, specifically so that a caller who does send one reaches the
// handler and gets an explicit, readable rejection (FORBIDDEN_PATCH_KEYS
// below) instead of the MCP layer silently dropping an argument the tool
// never declared.
const {
  id: _id,
  area: _area,
  kind: _kind,
  title: _title,
  source: _source,
  ...patchableShape
} = createEntryConfig.inputSchema;

export const config = {
  title: "Update entry",
  description:
    "Applies a partial patch to an existing entry and requires a reason, " +
    "which becomes the tending line ('Corrected: …'). Cannot change id, " +
    "area or kind — archive the entry and create a new one for that. " +
    "Cannot set archived_at — use archive_entry.",
  inputSchema: {
    id: z.string().min(1),
    area: z.enum(AREAS).optional(),
    kind: z.enum(KINDS).optional(),
    title: z.string().min(1).max(200).optional(),
    source: z.string().min(1).optional(),
    ...patchableShape,
  },
};

export async function handler(args: Record<string, unknown> & { id: string; reason: string }) {
  const lifeRoot = resolveLifeRoot();
  const existing = readEntry(lifeRoot, args.id);
  if (!existing || !isAreaReadable(lifeRoot, existing.entry.area)) {
    return {
      isError: true,
      content: [{ type: "text" as const, text: `No entry with id "${args.id}" exists.` }],
    };
  }

  const { reason, id: _patchId, ...patch } = args;
  for (const key of Object.keys(patch)) {
    if (FORBIDDEN_PATCH_KEYS.has(key)) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `update_entry cannot change "${key}". Use archive_entry for archived_at, or create_entry plus archive_entry to change area/kind/id.`,
          },
        ],
      };
    }
  }

  const kind = existing.entry.kind as Kind;
  const allowedKeys = new Set(fieldsForKind(kind));
  const merged: Record<string, unknown> = { ...existing.entry };
  // Captured before anything changes, so an undo (lib/tending/undo.ts) can
  // restore the exact previous state rather than guess at one. `null` marks
  // a field that had no previous value at all — distinct from JSON simply
  // dropping an `undefined` key, which an undo could not tell apart from
  // "leave this field alone."
  const revert: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!allowedKeys.has(key) || value === undefined) continue;
    const previous = (existing.entry as Record<string, unknown>)[key];
    revert[key] = previous === undefined ? null : previous;
    merged[key] = value;
  }

  const written = writeEntry(lifeRoot, merged as never);

  recordTending(lifeRoot, {
    tool: name,
    bucket: "corrected",
    entryId: written.entry.id,
    summary: `Corrected "${written.entry.title}".`,
    reason,
    revert: Object.keys(revert).length > 0 ? revert : undefined,
  });

  const body = { entry: written.entry, relative_path: written.relativePath };
  return { content: [{ type: "text" as const, text: JSON.stringify(body, null, 2) }] };
}
