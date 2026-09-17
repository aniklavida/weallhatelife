// Access requests — an agent asking for an area it may not currently read
// (docs/SPEC.md §8, "request_access"). Recorded as a plain file for a
// person to see, the same spirit as proposals.ts.
//
// **Honesty note, and it is load-bearing:** no access policy exists yet
// (lib/access/policy.ts is docs/ROADMAP.md step 3), and docs/SPEC.md §9
// still lists what survives of per-area grants as an open question. So
// this file does not grant, deny or gate anything — there is nothing to
// gate yet. It only guarantees the ask is not lost, and that the response
// an agent gets back says so plainly rather than implying an access system
// that is not there.
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

export interface AccessRequestInput {
  area: string;
  reason: string;
  duration?: string;
}

export interface WrittenAccessRequest {
  relativePath: string;
  requestedAt: string;
}

export function recordAccessRequest(lifeRoot: string, input: AccessRequestInput): WrittenAccessRequest {
  const requestedAt = new Date().toISOString();
  const stamp = requestedAt.replace(/[:.]/g, "-");
  const relativePath = `tended/access-requests/${input.area}-${stamp}.md`;
  const filePath = path.join(lifeRoot, relativePath);

  const frontMatter = {
    area: input.area,
    duration: input.duration,
    requested_at: requestedAt,
    status: "pending",
  };
  const contents = matter.stringify(`Reason: ${input.reason}\n`, frontMatter);

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, "utf8");

  return { relativePath, requestedAt };
}
