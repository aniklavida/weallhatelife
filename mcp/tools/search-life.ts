// `search_life` — one search across everything an agent may read. FTS5
// under the hood (lib/index/search.ts); this file only resolves the life
// root, refreshes the index and shapes the result. See docs/SPEC.md §8.
import { z } from "zod";
import { recordReadAccess } from "../../lib/access/log";
import { isAreaReadable } from "../../lib/access/policy";
import { AREAS, type Area } from "../../lib/entry/schema";
import { searchLife } from "../../lib/index/search";
import { ensureFreshIndex, resolveDbPath, resolveLifeRoot } from "../runtime";

export const name = "search_life";

export const config = {
  title: "Search life",
  description:
    "Full-text search over every entry's title and body. Supports FTS5 " +
    "query syntax: quoted phrases, AND/OR, and a trailing * for a prefix " +
    "match. Optionally filter to one area. Archived entries are excluded " +
    "unless include_archived is set.",
  inputSchema: {
    query: z.string().min(1).describe("FTS5 query, e.g. \"passport\" or \"rumi OR nani\""),
    area: z.enum(AREAS).optional().describe("Restrict results to one area."),
    limit: z.number().int().min(1).max(100).default(20).optional(),
    include_archived: z.boolean().default(false).optional(),
  },
};

export async function handler(args: {
  query: string;
  area?: (typeof AREAS)[number];
  limit?: number;
  include_archived?: boolean;
}) {
  const lifeRoot = resolveLifeRoot();

  // If filtered to a sealed area, return zero results — indistinguishable
  // from no matches in that area.
  if (args.area && !isAreaReadable(lifeRoot, args.area)) {
    const body = {
      query: args.query,
      count: 0,
      results: [],
    };
    return { content: [{ type: "text" as const, text: JSON.stringify(body, null, 2) }] };
  }

  const dbPath = ensureFreshIndex(lifeRoot, resolveDbPath());

  const hits = searchLife(dbPath, args.query, {
    limit: args.limit ?? 20,
    includeArchived: args.include_archived ?? false,
  })
    .filter((hit) => !args.area || hit.area === args.area)
    .filter((hit) => isAreaReadable(lifeRoot, hit.area as Area));

  recordReadAccess(lifeRoot, {
    tool: name,
    area: args.area,
    summary: `Searched "${args.query}" (${hits.length} result${hits.length === 1 ? "" : "s"}).`,
  });

  const body = {
    query: args.query,
    count: hits.length,
    results: hits,
  };
  return { content: [{ type: "text" as const, text: JSON.stringify(body, null, 2) }] };
}
