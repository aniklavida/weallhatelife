# WeAllHateLife! — product specification

**Status: draft. Nothing in this document is implemented.** Every capability described here is planned.

The two questions this document used to mark **Open** — the privacy model (§9) and whether an AI ships (§10) — are now decided. What remains open is marked so deliberately and is not an omission.

## 1 · What it is

A website you host yourself that holds a whole life — memories, people, money, body, papers, decisions, someday, alongside the ordinary tasks, projects, goals, habits and areas.

You connect whichever AI you already run over MCP. **That AI keeps it current.** You never fill in a field.

## 2 · The one idea

> Every other life system: **you maintain it, and it shows you your data.**
> This one: **the AI maintains it, and you visit.**

This is a test, not a tagline. Any design that asks the user to enter, tidy, reconcile or review something has failed it. The weekly review is not a ritual to support — it is the thing being removed.

## 3 · Who it is for

Someone who has already tried a life system and stopped. They built the databases, filled the properties for five weeks, missed a review, and never opened it again. They are not undisciplined; the system charged rent and stopped paying it.

They already talk to an AI most days. What they do not have is somewhere that **keeps** things without them.

Secondarily: people who self-host on principle and would rather their life not sit in a vendor's database.

## 4 · The two modes

**Most days, a glance.** Open it, see what needs you, close it. The honest answer is frequently *nothing*.

That makes **"Nothing needs you today" the most-viewed screen in the product**, so it is designed first and best. It is not an empty state, not a zero-results page, and it must never look like a page that failed to load. A life system whose quiet days look broken has taught its user that quiet is bad.

**Sometimes, a wander.** No task at all — reading old memories, seeing where the money is, noticing who has gone quiet. This is what makes it a place rather than a tool, and it is the harder problem: with no task to complete, the only thing that can hold someone is that it is pleasant to be in.

## 5 · What lives in it

`Tasks` · `Projects` · `Goals` · `Habits` · `Areas` — and the seven that make it a life rather than a productivity system:

| Area | What it holds |
|---|---|
| **Memories** | What happened. Days, photographs, "four years ago this week" |
| **People** | Not contacts — when you last spoke, what they are waiting on, who you are drifting from |
| **Money** | What you have, what is coming, what you are saving toward |
| **Body** | Sleep, appointments, the things you keep rescheduling |
| **Papers** | Passport, insurance, transcripts — what you need at 2am |
| **Decisions** | What you chose and why, so you do not re-argue it in six months |
| **Someday** | Things with no date and no guilt attached |

## 6 · The data model

### One envelope, many kinds

Every item in every area shares one envelope and adds typed fields per kind.

| Field | Meaning |
|---|---|
| `id` | Stable, human-readable, never reused |
| `area` | One of the twelve |
| `kind` | `memory` · `person` · `account` · `obligation` · `saving_goal` · `appointment` · `measurement` · `document` · `decision` · `someday` · `task` · `project` · `goal` · `habit` · `area` |
| `title` | One line |
| `body` | Markdown. Optional |
| `occurred_at` | When it happened or applies. May be fuzzy: `2019`, `2019-06`, `summer 2019` |
| `source` | **Who wrote this, and from what.** Required — `user`, an agent, or an import |
| `confidence` | For anything an agent inferred rather than was told |
| `links` | Typed edges to other entries |
| `attachments` | Originals, stored beside the entry, never rewritten |

One envelope rather than twelve schemas, because a life does not respect area boundaries: a memory has people in it, a document proves a decision, a saving goal is why a someday exists. It also keeps the agent-facing surface small, and agents handle one general shape far better than fifty specific ones.

### Fields per kind

| Kind | Beyond the envelope |
|---|---|
| `memory` | `place`, `people[]`, `media[]`, `mood` |
| `person` | `relationship`, `last_contact_at`, `contact_intent` (a gentle wish, never a rule), `open_threads[]` |
| `account` | `institution`, `kind`, `balance`, `balance_as_of` — **a balance is always a reading with a date**, never a live figure |
| `obligation` | `amount`, `cadence`, `next_due`, `counterparty` |
| `saving_goal` | `target`, `saved`, optional `target_date` — its absence is not a failure |
| `appointment` | `with`, `at`, `location`, `reschedule_count` — held privately and **never displayed as a count** |
| `measurement` | `metric`, `value`, `unit`, `taken_at` |
| `document` | `doc_kind`, `issuer`, `identifier_last4`, `issued_at`, `expires_at`, `physical_location` |
| `decision` | `chose`, `rejected[]`, `because`, `would_change_my_mind`, optional `revisit_after` |
| `someday` | `note` only. **Structurally cannot hold a due date** |
| `task` | optional `due`, `state`, optional `for_project` |
| `project` | optional `description`, `status`, optional `for_goal` |
| `goal` | optional `description`, optional `target_date` |
| `habit` | `occurrences[]` — timestamps only. **No streak field exists** |
| `area` | optional `description` — a broad, ongoing area of responsibility (Health, Family, Home), not one of the twelve data areas above |

Three of those are product decisions expressed as types: a balance is a dated reading, someday cannot hold a date, and habits have no streak. Each is enforced by the schema, because a convention that lives only in documentation gets violated by the first person who has not read it.

## 7 · Storage — a life is a directory

The durable store is **plain files**: markdown with front matter, one per entry, with attachments kept in their original bytes.

```
life/
├── memories/2019/2019-06-nani-house.md
├── people/rumi.md
├── papers/passport.md   +   passport.pdf
└── tended/2026-09-13.md
```

**SQLite is an index, not the store.** It holds the search table, the link graph and sort orders, and can be deleted and rebuilt from the files at any time. An acceptance test will do exactly that.

The product asks you to put your life in it. If the only copy lived in a schema that needed this application to read, it would have trapped the thing it promised to keep. Files survive the project being abandoned, survive a bad migration, and survive you changing your mind — and they make `git` a backup strategy you already know.

The honest cost: a file plus an index is two things that can disagree. The files always win, and the index is disposable.

## 8 · The agent surface

Around a dozen MCP tools, all area-agnostic. A large tool surface degrades agent accuracy and has to be relearned by every new model.

**Read** — `get_life_schema` (including **what this agent may currently read**, so it discovers a closed door rather than guessing) · `search_life` · `read_entry` · `list_area` · `whats_open`.

`whats_open` **returns "nothing" as a first-class answer**, not an empty list a model will feel obliged to fill.

**Write** — `create_entry` · `update_entry` · `link_entries` · `attach_file` · `archive_entry`.

**There is no delete tool.** An agent cannot destroy a memory, because that mistake is unrecoverable and unforgivable. Archiving is reversible and is the only removal.

**Trust and permission** — `leave_alone` · `propose` · `request_access`.

Two rules are doing real work:

- **Every write carries a required `reason`, and the reason becomes the visible tending line.** The trust surface is a by-product of writing rather than a second obligation the agent might forget.
- **`leave_alone` is a tool, not a no-op.** Restraint is invisible otherwise, and an agent that only shows its edits looks like one that never holds back.

## 9 · Privacy — **settled**

Health and money are in scope, so this is stated precisely rather than reassuringly.

**Three parts to the boundary, kept distinct in every document:**

1. **The OhMyLife server** stores everything on the user's own machine and initiates nothing of its own.
2. **A provider key the user configured** sends only what that feature needs, only to the provider they chose.
3. **The connected agent is outside our boundary.** Whatever it reads goes wherever that agent runs. We can show the user what was read; we cannot stop it leaving.

**This project therefore does not claim that your data never leaves your machine.** Under a hosted model that claim would be false, and a privacy claim that is only true in some configurations is not a privacy claim.

### Visibility tiers enforced at the tool boundary

There are no per-entry sensitivity tags, but **visibility tiers are enforced at the area level at the tool boundary** through `lib/access/policy.ts`:

- An agent asking for a **sealed area** gets **nothing** — not a filtered view whose shape it could infer from what is missing. Absence of a result and absence of the area are indistinguishable to the caller.
- `get_life_schema` tells an agent what it is currently allowed to read, so it discovers its boundaries up front rather than guessing from failures.
- `request_access` asks for an area with a reason and a duration. **Grants expire** — a permanent grant is a grant nobody revisits.
- **`propose` is the only path into a sealed area**, and it needs the person's yes. Direct creation, updates, and archiving in sealed areas are refused.
- **Revoking an area mid-session takes effect immediately**, on the very next tool call.

### The access log: what your agent read

Every time an agent reads an entry, lists an area, searches, or checks what is open, that read is logged with its timestamp, tool and area in `tended/access-log/YYYY-MM-DD.md`. The user can read what their agent *read*, and when — not only what it wrote.

### Data at rest stays readable — no application-level encryption

Entries stay plain Markdown on disk, openable in any text editor. Three reasons:

1. **It is the product's central promise.** A life must outlive the software. Plain Markdown still opens in any editor if this project is abandoned; encrypted files are landfill without the application that wrote them.
2. **Self-hosted means the operating system already covers this.** Full-disk encryption — FileVault, BitLocker, LUKS — handles the stolen-laptop threat, and handles it better than anything this project would write. **Disk encryption is the operating system's job**, and this document says so rather than implying the application does it.
3. **The cost is concrete.** Application-level encryption adds key management, a password-recovery story with no good answer, and backup complexity — and it breaks search outright, because the full-text index cannot index what it cannot read.

Encrypting a *single* entry — a passport number, a credential — rather than the whole store is noted as a possible future option. It is **not planned for v1.0**, and nothing should be built assuming it.

## 10 · Both connection paths ship — **settled**

Two products were hiding behind one repository. Both ship, and neither is a fallback for the other:

- **In-site BYOK.** The user pastes their own provider key into the WeAllHateLife website, and the built-in assistant works there. Nobody without an agent is locked out.
- **An MCP server.** WeAllHateLife exposes its own MCP server, so any MCP client connects to it directly. Connecting an agent the user already runs costs them nothing extra, and remains the primary path.

Both are **planned for v1.0**, and neither is released.

The trade-off that was weighed, kept for the record:

| | Bring your own agent only | A built-in assistant as well |
|---|---|---|
| Who can use it | People already running an MCP-capable AI | Anyone who can run a container |
| What the project maintains | A server and a website | Also the assistant's plumbing and a support surface for output quality it does not control |
| The risk | A smaller audience; the product looks inert without an agent | The project inherits blame for a model's bad day |

**No model is hosted by this project.** BYOK means the user's key and the user's provider; the second column's maintenance burden is accepted for the plumbing, never for the model.

A shipped tool-neutral *skill* — markdown that tells whichever agent the user already runs how to tend a life well — remains the plan for the MCP path, so a first session is guided rather than blank.

**The consequence for §9:** the in-site key is what makes the server itself capable of an outbound call. That is why §9 narrows the privacy claim instead of promising zero egress.

## 11 · Making the upkeep visible

A tending record, written automatically from the required reason on every write, readable as a day, a week, or the history of one entry.

| | Example |
|---|---|
| **Filed** | *"Added Thursday's dentist appointment from your message."* |
| **Corrected** | *"Your passport expiry said 2029; the scan says 2028. Changed it."* |
| **Left alone** | *"You've moved the dentist three times. I didn't reschedule it — that looked like a decision, not a slip."* |

On the home page this is one calm panel ending in *"All caught up for now."* The full record is a page of its own.

**Every line is reversible from the line itself.** A correction the agent got wrong is undone where you read it, not in a settings screen. Without that, showing the work is just a confession.

This is what replaces the weekly review: instead of a ritual you perform, it is an account the system renders.

## 12 · The life summary

Above everything on the home page: your life, summarised, as prose and image rather than metrics.

**The constraint is that you read it and feel *seen*, not *assessed*.**

Allowed: a handful of true, warm observations. *"A quiet fortnight. Two long conversations with Rumi. The passport renewal is the only thing with a clock on it."*

Never: a score out of 100, a grade, a ranking, a percentage complete, a progress ring, or a comparison to last month framed as better or worse. This is the one place numbers appear at all, and they appear inside sentences.

It is composed from observations the data can actually support, and **it never fills a fixed number of slots** — a fixed number of slots is how a summary starts inventing. It is generated rather than written by the connected model, so the most prominent surface in the product does not vary with whichever AI you happen to have brought.

## 13 · The constraints, as engineering

| Constraint | How it is enforced |
|---|---|
| No streaks | Habits have no streak field. Nothing computes one |
| No counts or badges | No badge component exists |
| No progress rings | No such component exists |
| Nothing red | The token set has no content-state red. Red is reserved for destructive confirmation in settings |
| Someday carries no guilt | `someday` cannot hold a due date, and never appears in `whats_open` |
| Overdue is not a state | A task past its date is *waiting*, in the same weight as any other. **No visual escalation over time** |

Every one of these exists because counts, badges, streaks and red manufacture guilt, and guilt is why people abandon these systems. A design system that has no red badge cannot grow one by accident.

## 14 · The theme layer

Photographs are **swappable data**, never hard-coded markup. A theme is a folder with a manifest supplying colour tokens, a type stack, and one image per slot — the hero rotation and one per area card.

**The structure never moves.** You pick a mood, or upload your own photo; the layout, type scale and spacing stay the product's.

**Uploading your own photo is the primary path.** *(Planned.)* Where a slot has no upload yet, the default is a small set of calm, category-wise images generated with an AI image tool — not stock photography, so there is no licence to source or track. Until that generated set ships, drawn placeholder scenes fill the slot instead.

Themes ship as folders, so a default set of images sits under a manifest alongside colour tokens and a type stack — the same slot a user's own upload fills, without touching code.

Light and dark are each designed — a warm, lamplit dark, not a flipped palette.

## 15 · Architecture

Next.js, App Router.

```
        your agent  (any MCP client)
                    │  MCP
             ┌──────┴──────┐
             │  MCP server │   the only write path
             └──────┬──────┘
             ┌──────┴──────┐
             │  life core  │   validate · write files · index · tend
             └──────┬──────┘
        plain files  +  SQLite index
             ┌──────┴──────┐
             │  Next.js    │   the place you visit — read-mostly
             └─────────────┘
```

**The website is read-mostly by design.** It renders; it does not maintain. A handful of human actions exist — undo a tending line, grant or revoke an area, swap a theme, archive something — and that is close to the whole interactive surface. If the website grows a full editor, the product has quietly become the thing it was built to replace.

**One core, two front doors.** The server and the website both go through the core; neither touches disk. The website's own assistant — the in-site BYOK path (§10) — is a third caller of the core, and the only component that makes an outbound provider call. Otherwise the rules that keep `someday` dateless and habits streakless exist in two places and drift apart.

## 16 · Self-hosting

The bar is one command.

```
docker run -v ./life:/life -p 3000:3000 weallhatelife
```

- **One container, one volume.** SQLite by default, Postgres supported. A second required service would be a second thing to keep running for the rest of your life.
- **The volume is the whole life.** Copy the folder and you have moved house. There is no export feature because there is nothing to export from.
- **MCP over stdio** for a local agent — no network, no token. Streamable HTTP behind a bearer token for a remote agent, off by default.
- **Backup is your own `git` repository**, if you want one. Plain files make that free rather than a feature.
- **No telemetry and no update check.** The server makes no outbound call of its own — **except to the provider whose key the user configured in-site (§10), and to nothing else.** To be asserted by a test in both configurations (§18), which is what will make it a claim rather than an intention.

## 17 · Non-goals

Not a hosted service · not a template for someone else's note tool · not a photo manager, a budgeting app or a document scanner · not a model we host · not a productivity system · not multi-user in v1 · **not anything that asks you to fill in a field.**

## 18 · v1 acceptance

- [ ] A fresh run with an empty volume produces a working, beautiful home page — no setup wizard, no empty-state apology.
- [ ] An agent connects over MCP, is handed the schema, and files a memory, a person, a document and an appointment with no human typing into the website.
- [ ] The home page carries a life summary with no score, grade, ranking, percentage or progress ring.
- [ ] **"Nothing needs you today" is reviewed and approved as a designed screen**, not an empty state.
- [ ] The tending panel shows filed, corrected **and left-alone** entries, and every line is reversible where it is read.
- [ ] Deleting the index and restarting rebuilds it from the files with no data loss.
- [ ] Swapping the theme folder changes every photograph and colour, and moves no layout.
- [ ] Every shipped photograph has a licence recorded in its theme manifest.
- [ ] Light and dark are each reviewed as designed surfaces.
- [ ] The component library contains no streak, badge count or content-state red.
- [ ] `someday` entries cannot be given a due date through any tool, and never appear in `whats_open`.
- [ ] An agent has no delete path; archiving is the only removal and it is reversible.
- [ ] With no in-site provider key configured, the server makes zero outbound network calls during a full session, asserted by a test. With a key configured, the only outbound calls are to that provider's endpoint — also asserted, because that is the narrower claim §9 actually makes.
- [ ] The privacy wording distinguishes the server's guarantee from the connected agent's behaviour, and neither sentence overstates.
- [ ] Every public claim has working evidence or is labelled planned.

## 19 · Risks

- **The product is a promise about someone else's model.** A careless agent leaves the life stale and makes this look broken. Output quality is outside the project's control, and the documentation says so rather than hoping.
- **The trust cliff.** One wrong silent write into someone's memories can end the relationship with the product permanently. The tending record and one-click reversal are the mitigation, and they are load-bearing rather than decorative.
- **Privacy wording is a real risk, not a documentation chore.** An unqualified "never leaves your machine" would be untrue under a hosted agent, and untrue again once an in-site provider key is configured. §9 fixes the exact sentence that may be written instead.
- **Photograph licensing could block release** more plausibly than any engineering task. A photographic product that cannot legally ship its photographs has no design.
- **Breadth.** Twelve areas is a wide surface. Depth has to be staged, and shipping all twelve shallowly would produce exactly the "every database needs updating" feeling the product exists to remove.
- **The wander mode has no success metric**, by design — it is the mode with no task. It can only be judged by whether it is pleasant, which means it can rot without anything failing.
- **No demand has been measured, and none is claimed.** This ships because the failure it addresses is documented by the category itself, not because a number said so.
