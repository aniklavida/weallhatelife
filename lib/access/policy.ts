// The single access gate — which areas an agent may read and write.
//
// docs/SPEC.md §8 and §9: access policy is enforced in the server. A sealed
// area returns nothing to an agent, indistinguishable from the area not
// existing. Grants are time-bounded and expire automatically. Revocation
// takes effect immediately on the next tool call. `propose` is the only path
// into a sealed area, and it requires the person's yes.
import fs from "node:fs";
import path from "node:path";
import { readEntry } from "../entry/read";
import { AREAS, type Area } from "../entry/schema";

export interface Grant {
  area: Area;
  granted_at: string;
  expires_at: string;
  duration: string;
  reason: string;
}

export interface AccessPolicy {
  /** Areas that are sealed from agent access. */
  sealed_areas: Area[];
  /** Grants keyed by area name. */
  grants: Partial<Record<Area, Grant>>;
}

const POLICY_FILE_RELATIVE = path.join("tended", "access-policy.json");

/**
 * Parses a duration string like "7d", "30d", "1h", "5s", "100ms" into milliseconds.
 * Permanent or indefinite grants are rejected: a grant nobody revisits is a
 * permanent hole in the policy.
 */
export function parseDuration(duration: string): number {
  const trimmed = duration.trim();
  if (/^(indefinite|permanent|forever|none|unlimited)$/i.test(trimmed)) {
    throw new Error(
      `Grants must expire — "${duration}" is not permitted. Specify a finite duration like "7d" or "30d".`,
    );
  }

  const match = trimmed.match(/^(\d+)\s*(d|day|days|h|hour|hours|m|min|minute|minutes|s|sec|second|seconds|ms)$/i);
  if (!match) {
    throw new Error(
      `Invalid duration "${duration}". Specify a quantity and unit, e.g. "7d", "30d", "24h", "5s".`,
    );
  }

  const value = Number.parseInt(match[1] as string, 10);
  const unit = (match[2] as string).toLowerCase();

  if (unit.startsWith("ms")) return value;
  if (unit.startsWith("s")) return value * 1000;
  if (unit.startsWith("m")) return value * 60 * 1000;
  if (unit.startsWith("h")) return value * 60 * 60 * 1000;
  if (unit.startsWith("d")) return value * 24 * 60 * 60 * 1000;

  throw new Error(`Unsupported duration unit in "${duration}".`);
}

function policyFilePath(lifeRoot: string): string {
  return path.join(lifeRoot, POLICY_FILE_RELATIVE);
}

/**
 * Reads the current access policy from disk. Always reads the file afresh so
 * mid-session changes (grants or revocations) take effect on the very next call.
 */
export function readPolicy(lifeRoot: string): AccessPolicy {
  const filePath = policyFilePath(lifeRoot);
  if (!fs.existsSync(filePath)) {
    return { sealed_areas: [], grants: {} };
  }
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<AccessPolicy>;
    return {
      sealed_areas: Array.isArray(parsed.sealed_areas) ? parsed.sealed_areas : [],
      grants: typeof parsed.grants === "object" && parsed.grants !== null ? parsed.grants : {},
    };
  } catch {
    return { sealed_areas: [], grants: {} };
  }
}

/** Writes the access policy to disk. */
export function writePolicy(lifeRoot: string, policy: AccessPolicy): void {
  const filePath = policyFilePath(lifeRoot);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(policy, null, 2) + "\n", "utf8");
}

function assertValidArea(area: string): asserts area is Area {
  if (!(AREAS as readonly string[]).includes(area)) {
    throw new Error(`Unknown area "${area}". Known areas: ${AREAS.join(", ")}.`);
  }
}

/** Seals an area from direct agent access. Any active grant for the area is removed. */
export function sealArea(lifeRoot: string, area: Area): void {
  assertValidArea(area);
  const policy = readPolicy(lifeRoot);
  if (!policy.sealed_areas.includes(area)) {
    policy.sealed_areas.push(area);
  }
  delete policy.grants[area];
  writePolicy(lifeRoot, policy);
}

/** Unseals an area, making it open to reading and writing. */
export function unsealArea(lifeRoot: string, area: Area): void {
  assertValidArea(area);
  const policy = readPolicy(lifeRoot);
  policy.sealed_areas = policy.sealed_areas.filter((a) => a !== area);
  delete policy.grants[area];
  writePolicy(lifeRoot, policy);
}

/**
 * Grants temporary access to an area with a mandatory reason and duration.
 * The grant carries a strict `expires_at` timestamp.
 */
export function grantAccess(
  lifeRoot: string,
  options: {
    area: Area;
    duration: string;
    reason: string;
    grantedAt?: string;
  },
): Grant {
  assertValidArea(options.area);
  if (!options.reason || options.reason.trim().length === 0) {
    throw new Error("A reason is required to grant access.");
  }

  const durationMs = parseDuration(options.duration);
  const grantedAt = options.grantedAt ?? new Date().toISOString();
  const expiresAt = new Date(new Date(grantedAt).getTime() + durationMs).toISOString();

  const grant: Grant = {
    area: options.area,
    granted_at: grantedAt,
    expires_at: expiresAt,
    duration: options.duration,
    reason: options.reason.trim(),
  };

  const policy = readPolicy(lifeRoot);
  policy.grants[options.area] = grant;
  writePolicy(lifeRoot, policy);
  return grant;
}

/**
 * Revokes access to an area immediately. Any active grant is removed and the
 * area is placed in `sealed_areas`. Takes effect on the very next tool call.
 */
export function revokeAccess(lifeRoot: string, area: Area): void {
  assertValidArea(area);
  const policy = readPolicy(lifeRoot);
  delete policy.grants[area];
  if (!policy.sealed_areas.includes(area)) {
    policy.sealed_areas.push(area);
  }
  writePolicy(lifeRoot, policy);
}

/** Checks whether a grant is currently active (i.e. has not expired). */
export function isGrantActive(grant: Grant | undefined, now: Date = new Date()): boolean {
  if (!grant || !grant.expires_at) return false;
  return new Date(grant.expires_at).getTime() > now.getTime();
}

/**
 * Determines whether an agent may read entries in this area.
 *
 * An area is readable if:
 * 1. It is not sealed in the policy, OR
 * 2. It has an active, non-expired grant.
 */
export function isAreaReadable(lifeRoot: string, area: Area, now: Date = new Date()): boolean {
  const policy = readPolicy(lifeRoot);
  const isSealed = policy.sealed_areas.includes(area);
  if (!isSealed) return true;

  const grant = policy.grants[area];
  return isGrantActive(grant, now);
}

/**
 * Determines whether an agent may directly write entries to this area.
 *
 * A sealed area cannot be directly written to even with a read grant:
 * `propose` is the only path into a sealed area, and it needs the person's yes.
 */
export function isAreaWritable(lifeRoot: string, area: Area): boolean {
  const policy = readPolicy(lifeRoot);
  return !policy.sealed_areas.includes(area);
}

/**
 * Checks whether an entry exists AND is in an area readable by the agent.
 * If the entry is in a sealed area, returns `false` — making absence of the
 * result indistinguishable from the entry not existing.
 */
export function isEntryReadable(lifeRoot: string, id: string, now: Date = new Date()): boolean {
  const found = readEntry(lifeRoot, id);
  if (!found) return false;
  return isAreaReadable(lifeRoot, found.entry.area, now);
}

export interface AccessInfo {
  enforced: boolean;
  readableAreas: Area[];
  writableAreas: Area[];
  sealedAreas: Area[];
  grants: Record<string, Grant>;
}

/**
 * Summarises what this agent is currently allowed to read and write.
 * Returned by `get_life_schema` so the agent discovers its boundaries up front.
 */
export function getAccessInfo(lifeRoot: string, now: Date = new Date()): AccessInfo {
  const policy = readPolicy(lifeRoot);
  const readableAreas = AREAS.filter((area) => isAreaReadable(lifeRoot, area, now));
  const writableAreas = AREAS.filter((area) => isAreaWritable(lifeRoot, area));
  const sealedAreas = AREAS.filter((area) => !readableAreas.includes(area));

  const activeGrants: Record<string, Grant> = {};
  for (const [area, grant] of Object.entries(policy.grants)) {
    if (grant && isGrantActive(grant, now)) {
      activeGrants[area] = grant;
    }
  }

  return {
    enforced: true,
    readableAreas,
    writableAreas,
    sealedAreas,
    grants: activeGrants,
  };
}
