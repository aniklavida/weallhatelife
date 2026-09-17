# Architecture

**Nothing here is implemented.** This is the shape the first commits build into.

## The shape

```
        your agent  (Claude · Codex · Gemini · any MCP client)
                            │  MCP
                     ┌──────┴──────┐
                     │  MCP server │   the only write path
                     └──────┬──────┘
                            │
                     ┌──────┴──────┐
                     │  life core  │   validate · write files · index · tend
                     └──────┬──────┘
                            │
               plain files  +  SQLite index
                            │
                     ┌──────┴──────┐
                     │  Next.js    │   the place you visit — read-mostly
                     └─────────────┘
```

Four layers, and three of the four exist to protect a promise the product made to a person about their own life.

## 1 · The store is files. The index is disposable.

Entries are markdown with front matter, one file each, with attachments kept in their original bytes beside them.

```
life/
├── memories/2019/2019-06-nani-house.md
├── people/rumi.md
├── money/accounts/city-bank-savings.md
├── papers/passport.md   +   passport.pdf
├── decisions/left-the-agency.md
├── someday/learn-to-sail.md
└── tended/2026-09-13.md
```

SQLite holds full-text search, the link graph and sort orders. **It is derived state.** Delete it, restart, and it rebuilds — and a test will assert exactly that, because a rule nobody checks is a rule that has already been broken somewhere.

**Why this and not a database.** The product asks someone to put their life in it. A store that needs this application to be readable would have trapped the thing it promised to keep. Files outlive the project, outlive a bad migration, and outlive the user changing their mind. They also make `git` a backup strategy the user already understands, and a text editor a recovery tool.

The honest cost is drift: two representations can disagree. The resolution is fixed and one-directional — **the files win, always.** Nothing is ever written to the index that does not exist in a file.

## 2 · One core, two front doors

`lib/` is the only code that touches disk. The MCP server and the website both go through it, and neither reaches past it. The website's own assistant — the in-site key path, planned for v1.0 — is a third caller of `lib/` and the only component that makes an outbound provider call.

Without that rule, the rules that make `someday` dateless, habits streakless and deletion impossible would exist in two places and drift apart. With it, they exist once, in the schema, and every path inherits them.

`lib/` imports neither `app/` nor `mcp/`. A dependency test in CI enforces the direction.

## 3 · The MCP server is the write path

The agent-facing surface is around a dozen area-agnostic tools. It is kept small on purpose: a large tool surface degrades agent accuracy and has to be relearned by every new model, and this product is used by whichever model the user happened to bring.

Three properties of that surface are architectural rather than cosmetic:

**No delete tool exists.** Not disabled, not permission-gated — absent. An agent can archive with a reason, and archiving is reversible. An agent destroying a memory is an unrecoverable mistake, and the only reliable defence against an unrecoverable mistake is to make it unrepresentable.

**Every write requires a `reason`,** and that reason is what the user reads in the tending record. The trust surface is therefore a by-product of writing rather than a second obligation an agent might skip. An agent that forgets to log is impossible, because the log *is* the write.

**`leave_alone` is a real tool.** An agent records that it looked at something and deliberately changed nothing. Restraint is invisible otherwise, and invisible restraint earns no trust.

## 4 · The website reads

Server components render; the interactive surface is deliberately small — undo a tending line, grant or revoke an area, swap a theme, archive something.

**This is a constraint, not a stage of development.** If the website grows a full editor, the product has quietly become the thing it was built to replace: a system you maintain. A pull request that adds an edit route needs to say why it could not have been an agent action.

Images are the performance budget in a photographic design, so they are processed at build or import time, never per request.

## 5 · Access is decided in one place

Every read path asks a single policy module (`lib/access/policy.ts`) which areas the connected agent may see. No tool decides for itself.

The reasoning is unglamorous: with per-tool checks, the one tool whose check is forgotten is the one that leaks health data. One gate can be reviewed once and tested once.

There are **no per-entry tiers, and nothing is encrypted at rest** — see [SPEC §9](SPEC.md#9--privacy--settled). Visibility tiers are enforced at the area boundary **of this server**: sealed areas return nothing, indistinguishable from the area having no entries. That binds any caller whose only route in is the MCP tools. It does not bind an agent with direct filesystem access — entries are plain Markdown and unencrypted, so such an agent can read a sealed area without this server seeing it. See the README for how that limit is stated to users. `request_access` asks with a duration, grants expire, and `propose` is the only path into a sealed area.

## 6 · The boundary the architecture cannot cross

The connected agent runs outside this system. Whatever it reads goes wherever that agent runs.

No architectural choice here changes that, and the design does not pretend otherwise. What it does is keep three parts distinct:

1. **The OhMyLife server** stores everything on the user's own machine and initiates nothing of its own.
2. **A provider key the user configured** sends only what that feature needs, only to the provider they chose.
3. **The connected agent is outside our boundary.** Whatever it reads goes wherever that agent runs. We can show the user what was read; we cannot stop it leaving.

The access log (`tended/access-log/`) records what the agent read and when, and the tending record shows what it did.

## 7 · Themes are data

A theme is a folder: a manifest of colour tokens, a type stack, image slots, and a licence line per image. Components read tokens and slots; they never hard-code a photograph, a colour or a font stack.

That is what makes a user's own photographs a first-class feature rather than a fork.

## 8 · What the tests protect

The structural tests are not coverage — each one guards a promise:

| Test | Promise |
|---|---|
| Index rebuilds from files | Your life is not trapped in our schema |
| No agent delete path exists | An agent cannot destroy a memory |
| `someday` cannot take a date | Someday carries no guilt |
| No badge, ring or content-state red in the component library | No guilt mechanics, structurally |
| No outbound call without a provider key; calls only to chosen provider with one | The privacy claim is a claim and not an intention |
| `lib/` imports neither `app/` nor `mcp/` | One core, and the rules live in one place |

Every one of them is the kind of rule that a contributor who has not read the documentation would otherwise break in good faith. Documentation cannot stop that. A failing build can.

**Both halves of the egress guarantee are proven by tests**, in `tests/no-egress.test.ts`: zero egress with no key configured, and calls strictly to the configured provider endpoint with one, with zero telemetry or analytics destinations.

And **the build is not the server.** `app/fonts.ts` loads its three families through `next/font/google`, which downloads them from Google during `next build` and self-hosts the files it gets — which is why the running server serves fonts from itself and makes no font request. The download is real, though: `next build` fails outright with no route to `fonts.googleapis.com`, so this repository cannot be built offline. Turbopack makes that request natively rather than through Node, where nothing a test can intercept will observe it, so the test asserts it from the source and pins it to the single file responsible.

And **the build is not the server.** `app/fonts.ts` loads its three families through `next/font/google`, which downloads them from Google during `next build` and self-hosts the files it gets — which is why the running server serves fonts from itself and makes no font request. The download is real, though: `next build` fails outright with no route to `fonts.googleapis.com`, so this repository cannot be built offline. Turbopack makes that request natively rather than through Node, where nothing a test can intercept will observe it, so the test asserts it from the source and pins it to the single file responsible.
