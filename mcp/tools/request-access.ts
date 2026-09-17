// `request_access` — ask for an area this agent may not currently read
// (docs/SPEC.md §8). Honesty note, same as get-life-schema.ts: no access
// policy is enforced in this version (docs/ROADMAP.md step 3), so every
// area is already readable. Whether per-area grants survive as a mechanism
// at all is one of the questions docs/SPEC.md §9 lists as still open. This
// tool still exists and still records the ask, because an agent should
// form the habit of asking before the day a policy exists to answer it —
// but the response says plainly that nothing is being gated in this
// version, rather than pretending a grant just happened.
import { z } from "zod";
import { isAreaReadable, parseDuration } from "../../lib/access/policy";
import { AREAS } from "../../lib/entry/schema";
import { recordAccessRequest } from "../../lib/tending/access-requests";
import { resolveLifeRoot } from "../runtime";

export const name = "request_access";

export const config = {
  title: "Request access",
  description:
    "Records a request for access to an area, with a reason and a " +
    "duration. Permanent grants are not permitted — all grants expire. " +
    "Requests for sealed areas are recorded for human review.",
  inputSchema: {
    area: z.enum(AREAS),
    reason: z.string().min(1),
    duration: z.string().min(1).optional().describe('e.g. "7d", "30d", "24h"'),
  },
};

export async function handler(args: { area: (typeof AREAS)[number]; reason: string; duration?: string }) {
  const duration = args.duration ?? "7d";
  try {
    parseDuration(duration);
  } catch (error) {
    return {
      isError: true,
      content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
    };
  }

  const lifeRoot = resolveLifeRoot();
  const written = recordAccessRequest(lifeRoot, {
    area: args.area,
    reason: args.reason,
    duration,
  });

  const readable = isAreaReadable(lifeRoot, args.area);
  const body = {
    relative_path: written.relativePath,
    area: args.area,
    duration,
    granted: readable,
    status: readable ? "granted" : "pending",
    note: readable
      ? `Area "${args.area}" is already readable.`
      : `Access request recorded for "${args.area}" with duration "${duration}". Access requires the person's approval.`,
  };
  return { content: [{ type: "text" as const, text: JSON.stringify(body, null, 2) }] };
}
