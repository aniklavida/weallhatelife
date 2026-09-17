// `get_life_schema` — called first by any agent, so it discovers the shape
// of a life (and what it may currently read) rather than guessing. See
// docs/SPEC.md §8.
import { getAccessInfo } from "../../lib/access/policy";
import { AREA_FOR_KIND, AREAS, KINDS } from "../../lib/entry/schema";
import { resolveLifeRoot } from "../runtime";

export const name = "get_life_schema";

export const config = {
  title: "Get life schema",
  description:
    "Returns every area and kind this server knows, which kind belongs to " +
    "which area, and what this agent is currently allowed to read. Call " +
    "this first, before reading or writing anything.",
  inputSchema: {},
};

export async function handler() {
  const lifeRoot = resolveLifeRoot();
  const info = getAccessInfo(lifeRoot);

  const schema = {
    areas: AREAS,
    kinds: KINDS,
    area_for_kind: AREA_FOR_KIND,
    access: {
      enforced: true,
      readable_areas: info.readableAreas,
      writable_areas: info.writableAreas,
      sealed_areas: info.sealedAreas,
      grants: info.grants,
      note:
        "Access policy is enforced. Sealed areas return nothing and cannot " +
        "be read or directly written without an active grant. Use request_access " +
        "to ask for a time-bounded grant, or propose to suggest changes in sealed areas.",
    },
  };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(schema, null, 2) }],
  };
}
