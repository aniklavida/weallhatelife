# WeAllHateLife! — contributor and agent instructions

The canonical guide for humans and coding agents working in this repository. Tool-neutral: Claude, Codex, Cursor, Gemini CLI and others read this file.

> This file is about **contributing to WeAllHateLife**. It is not the instruction set for an AI that *tends someone's life* — that lives in `skill/`, ships with the product, and is written for the end user's agent.

## What this repository is

A self-hosted website that holds a whole life. The user connects whichever AI they already run over MCP, and that AI keeps it current.

**Status: pre-implementation.** The specification, architecture and structure exist. Working code does not yet.

## The one rule that matters

**The AI maintains it. The user visits.**

Every change is measured against that sentence. If a change asks the user to enter, tidy, reconcile or review something, it is wrong regardless of how well it is built — it reintroduces the maintenance cost this product exists to remove.

A practical consequence: **the website is read-mostly.** The MCP server is the write path. A new API route that lets the website edit an entry is almost always the wrong shape, and needs a reason in the pull request.

## Setup

Node and npm. Next.js App Router, TypeScript.

```bash
npm install
npm run dev        # the website
npm run mcp        # the MCP server, over stdio
npm test
npm run lint
npm run typecheck
```

## Structure

```
app/           the place you visit — read-mostly
components/    the design system, then the surfaces
lib/           life core — the ONLY code that touches a life
mcp/           the MCP server — the only write path
themes/        swappable photographs, palettes, type
skill/         tool-neutral instructions for the user's own agent
```

**Rules.** `tests/layer-boundaries.test.ts` walks the import graph on every push and fails the build on a crossing. An import graph cannot see everything these rules say, so where a rule reaches further than the check does, the remainder is named as review rather than left to look enforced.

- **`lib/` is the only code that touches disk.** `app/`, `components/`, `mcp/` and `scripts/` go through it.
  *Checked:* no module outside `lib/` imports a filesystem, SQLite or front-matter module.
  *Review:* disk opened on your behalf by a dependency you hand a path to. The check reads imports, not behaviour.
- **`lib/` imports neither `app/` nor `mcp/`.** The moment it does, it stops being core.
  *Checked in full*, along with the rest of the direction — `mcp/` sees `lib/`; `app/` sees `components/` and `lib/`; `components/` sees `lib/`; nothing sees upward. Relative paths and the `@/` alias both resolve.
- **Schemas are defined once**, in `lib/entry/schema.ts`. A file format described in three places breaks in two of them — and this is the format someone's life is stored in.
  *Checked:* `AREAS`, `KINDS`, `AREA_FOR_KIND` and `entrySchema` are declared in that file and nowhere else.
  *Review:* a second copy of the same format written under different names. Nothing mechanical recognises that.
- **No delete path exists for an agent, anywhere.** Archiving is the only removal, and it is reversible.
  *Checked:* no tool is named for removal, `mcp/` has no filesystem module to call, `tests/mcp-server.test.ts` asserts the exact tool list over the wire, and `archive_entry` is shown to leave the file where it was.

`tests/` is outside all of this on purpose: test scaffolding builds and discards throwaway lives, so it opens files directly.

## The constraints are structural, not stylistic

These are the product. Do not weaken them because a linter would have been easier.

| Constraint | How it is enforced |
|---|---|
| No streaks | Habits have no streak field. Nothing computes one |
| No counts or badges | No badge component exists |
| No progress rings | No such component exists |
| Nothing red | `tokens.css` has no content-state red. Red is reserved for destructive confirmation in settings |
| Someday carries no guilt | `someday` entries structurally cannot hold a due date, and never appear in `whats_open` |
| Overdue is not a state | A task past its date is *waiting*, rendered in the same weight as any other. No visual escalation |

If a feature needs one of these, the feature is wrong. Each exists because counts, badges, streaks and red manufacture guilt, and guilt is why people abandon these systems.

## Writing to a life

Every write takes a **required `reason`**, and that reason becomes the visible line in the tending record. This is deliberate: the trust surface is a by-product of writing rather than a second thing to remember. Do not add a write path that bypasses it.

`leave_alone` is a real tool, not a no-op. An agent recording that it looked and deliberately changed nothing is the single most reassuring thing this product can show, and it only works if it is written as carefully as an edit.

## Storage

The durable store is plain markdown files with front matter. **SQLite is an index and nothing else** — it must be deletable and rebuildable from the files at any time, and a test proves it.

Never add a field that exists only in the index. If it is part of a life, it belongs in the file.

## The quiet state

"Nothing needs you today" is a **designed screen**, not an empty state. It lives in `components/quiet/` as its own component so that it is reviewable as a screen. Do not fold it into a conditional branch inside another component — a quiet state buried in an `if` is a quiet state nobody designed.

## Themes

A theme is a folder: `theme.json` plus images. **Never hard-code a photograph, a colour or a font stack into a component** — read it from the active theme.

**Users upload their own photo for a slot; that's the primary path.** *(Planned.)* Where a slot has no upload, the default is a small set of calm, category-wise images generated with an AI image tool — not stock photography, so there's no licence to record. Until that generated set ships, drawn placeholder scenes fill the slot instead.

## Privacy

Health and money are in scope. Two rules:

- **Never widen what an agent can read without going through `lib/access/policy.ts`.** It is the single gate; a tool that checks for itself is the tool that eventually leaks.
- **Never write a privacy claim that is not true under every configuration.** Specifically: this project does not claim that your data never leaves your machine — a connected cloud agent takes whatever it reads with it, and an in-site provider key makes the server itself call that provider. The sentence that is true is *"nothing leaves unless you configure a key, and then only to the provider you chose."* Describe the server's guarantee and the agent's behaviour separately.

## Truthfulness

Every public claim is one of: **implemented and tested**, **experimental**, **planned**, or **unsupported**. Never describe a planned capability as working. If you cannot demonstrate it, label it planned.

Never invent stars, downloads, users, benchmarks or demand. No demand has been measured for this product, and none is claimed.

## Dependencies

Check that a dependency exists, is maintained, and carries a licence compatible with an MIT project before adding it. State its licence in the pull request.

## Tests

Unit tests for `lib/`, and a set of structural tests that protect the promises above: the index rebuilds from files, no agent delete path exists, `someday` cannot take a date, and the component library has no badge or ring. Those are not optional extras — they are how the product's guarantees stay true after the people who wrote them move on.

**Egress guarantees are proven across configurations**, in `tests/no-egress.test.ts`:

- **Proven — with no provider key configured, nothing the server runs opens a connection.** Every outbound surface Node offers is replaced with one that records the destination and refuses the call — `fetch`, `http`, `https`, `http2`, and `net`, `tls` and `dns` underneath them — and the real paths run against it: the home route in both of its states, and an MCP session calling all thirteen tools, reads and writes alike. Structurally as well, which covers the paths no test walks: no shipped module imports an HTTP client, a socket or a resolver, none calls `fetch` (except `lib/provider/dispatch.ts` when configured), no stylesheet loads a font or an image from another host, and the rendered page hands the visitor's browser no remote URL either.
  *Read the first test before changing any of this.* It dials every intercepted surface on purpose, because without it the whole file passes just as happily when the detector is broken.
- **Proven — with a key configured, calls only to that provider and to nothing else.** The in-site provider dispatcher routes strictly to the user's chosen provider. No telemetry, no update check, and no analytics destinations are ever dialled under any configuration.
- **The build is not the server, and the build does reach Google.** `app/fonts.ts` loads three families through `next/font/google`, which downloads them at build time and self-hosts the files, so the running server serves its own fonts and makes no font request. But `next build` fails with no route to `fonts.googleapis.com` — **this repository cannot be built offline.** Turbopack makes that request natively, outside Node, where nothing a test can patch will see it, so the test pins it to the one file that causes it rather than leaving it to be found with a packet capture.
