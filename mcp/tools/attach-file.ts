// `attach_file` — stores an original file beside an entry, never rewritten
// (docs/SPEC.md §7.1, §8). Accepts either a local path (the common case for
// a local, stdio-connected agent that already has filesystem access) or
// base64 bytes (for a remote agent with no shared filesystem).
import { z } from "zod";
import { isAreaReadable } from "../../lib/access/policy";
import { attachFile } from "../../lib/entry/attach";
import { readEntry } from "../../lib/entry/read";
import { recordTending } from "../../lib/tending/record";
import { resolveLifeRoot } from "../runtime";

export const name = "attach_file";

export const config = {
  title: "Attach file",
  description:
    "Copies a file's original bytes beside an existing entry and adds it " +
    "to that entry's attachments. Provide either source_path (a path this " +
    "server can read) or content_base64 (for an agent with no shared " +
    "filesystem). Requires a reason.",
  inputSchema: {
    id: z.string().min(1),
    filename: z.string().min(1),
    source_path: z.string().min(1).optional(),
    content_base64: z.string().min(1).optional(),
    reason: z.string().min(1),
  },
};

export async function handler(args: {
  id: string;
  filename: string;
  source_path?: string;
  content_base64?: string;
  reason: string;
}) {
  if (!args.source_path && !args.content_base64) {
    return {
      isError: true,
      content: [{ type: "text" as const, text: "Provide either source_path or content_base64." }],
    };
  }

  const lifeRoot = resolveLifeRoot();
  const existing = readEntry(lifeRoot, args.id);
  if (!existing || !isAreaReadable(lifeRoot, existing.entry.area)) {
    return {
      isError: true,
      content: [{ type: "text" as const, text: `No entry with id "${args.id}" exists.` }],
    };
  }

  let written: ReturnType<typeof attachFile>;
  try {
    written = attachFile(lifeRoot, args.id, {
      filename: args.filename,
      sourcePath: args.source_path,
      bytesBase64: args.content_base64,
    });
  } catch (error) {
    return {
      isError: true,
      content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
    };
  }

  recordTending(lifeRoot, {
    tool: name,
    bucket: "filed",
    entryId: written.entry.id,
    summary: `Attached "${args.filename}" to "${written.entry.title}".`,
    reason: args.reason,
  });

  const body = { entry: written.entry, relative_path: written.relativePath };
  return { content: [{ type: "text" as const, text: JSON.stringify(body, null, 2) }] };
}
