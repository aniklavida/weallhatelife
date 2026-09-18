# Security policy

## Supported versions

WeAllHateLife has no public release yet, so no version is supported.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability, a leaked credential, or anything containing private data. GitHub private vulnerability reporting must be enabled before v1.0.

Include the affected commit, reproduction steps, impact and sanitized evidence. **Never include a real token, a real document number, a real account number, or anyone's actual life data** — an invented reproduction is better than a real one here.

## Why the threat model is unusual

This application is designed to hold the things a person would least like exposed: health records, money, identity documents, and memories. It is also designed to hand parts of that to an AI agent that the project does not control.

Two boundaries, and only the first is ours:

- **The server** runs on the user's own machine and stores plain files in a volume they own. It sends no telemetry and runs no update check; with an in-site provider key configured it calls that provider and nothing else. The v1 tests enforce exactly this: zero egress with no key configured, and calls only to the chosen endpoint with one.
- **The connected agent** is outside that boundary. Whatever it reads travels to wherever that agent runs. The project can show the user what was read; it cannot prevent it leaving.

**This project therefore does not claim that a user's data never leaves their machine.** That claim would be untrue under a cloud-hosted agent, and untrue again once an in-site provider key is configured. A security policy that overstates is worse than none.

## Security model — planned

Some features below are now implemented, but others remain planned.

- Access to each area is decided in one place, so no individual tool can widen it.
- Agents have no delete path. Removal is archiving, and it is reversible.
- Every write is attributed and reversible from where the user reads it.
- The remote MCP transport is off by default; a local agent connects over stdio with no network at all.
- **There are no sensitivity tiers and no application-level encryption for life entries.** The credential store for the in-site provider encrypts your API key at rest against incidental reading (implemented and tested), but entries stay plain Markdown on disk; Entries stay plain Markdown on disk; full-disk encryption — FileVault, BitLocker, LUKS — is the operating system's job and is where the stolen-device threat is handled. Anyone who wants nothing leaving their machine points this at a local model, or connects no model at all.
- Which areas an agent may read without asking is **still being decided** and is marked open in the [specification](docs/SPEC.md). **No access policy is enforced today** — the MCP server reports its access state as unenforced. Do not assume any gating is in place.
- Secrets stay outside the repository. `.env` is never committed.
