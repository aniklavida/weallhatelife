# WeAllHateLife!

**A self-hosted home for your whole life. Your AI keeps it current. You just visit.**

Memories, people, money, body, papers, decisions, someday — alongside the ordinary tasks, projects, goals, habits and areas. You host it. You connect whichever AI you already run over [MCP](https://modelcontextprotocol.io) — or paste your own provider key into the site itself. It does the filing.

> **Pre-implementation.** This repository currently contains the product specification, architecture and structure. **There is no working release yet, and nothing described below is implemented.** Every capability is planned.

## The one idea

> Every other life system: **you maintain it, and it shows you your data.**
> This one: **the AI maintains it, and you visit.**

That is not a feature. It is the test every design decision has to pass. If something asks you to fill in a field, tidy a database or sit through a weekly review, it does not belong here.

## Why these systems fail

The category tends to be honest about it in its own documentation. Guides to building one of these usually admit two things: completeness is a trap, because every database needs updating and every property needs filling — and the weekly review is the real investment, because without it everything slowly falls apart.

Both are rent you pay forever. You build the databases, you fill the properties for five weeks, you miss one review, and you never open it again. That is not a discipline problem — the system charged rent and stopped paying it.

An agent that reads, files and corrects removes both. But only if the product is built around the agent doing the work, rather than bolting an assistant onto a system that still expects you to type.

## What lives in it

The ordinary set — `Tasks` · `Projects` · `Goals` · `Habits` · `Areas` — and the seven that make it a life rather than a productivity system:

| Area | What it holds |
|---|---|
| **Memories** | What happened. Days, photographs, "four years ago this week" |
| **People** | Not contacts — when you last spoke, what they're waiting on, who you're drifting from |
| **Money** | What you have, what's coming, what you're saving toward |
| **Body** | Sleep, appointments, the things you keep rescheduling |
| **Papers** | Passport, insurance, transcripts — what you need at 2am |
| **Decisions** | What you chose and why, so you don't re-argue it in six months |
| **Someday** | Things with no date and no guilt attached |

## Two ways people use it

**Most days, a glance.** Open it, see what needs you, close it. Often the honest answer is *nothing* — which should make **"Nothing needs you today" the most-viewed screen in the product**, so it is the one being designed first and best. It is not an empty state and it should never look like a page that failed to load. A life system whose quiet days look broken has taught you that quiet is bad.

**Sometimes, a wander.** No task at all. Reading old memories, checking where the money is, noticing who has gone quiet. This is the mode that makes it a place rather than a tool.

## No guilt mechanics. Structurally.

**No counts. No badges. No streaks. No scores. No progress rings. Nothing red.**

Every one of those exists to manufacture guilt, and guilt is why people abandon these systems. They are not discouraged by a style guide here — they are absent from the schema and the component library:

- Habits store occurrences and **nothing computes a streak**. A streak you never calculate cannot be broken.
- `Someday` entries **cannot hold a due date**. The type does not have the field.
- A task past its date is *waiting*, in the same weight as everything else. **There is no visual escalation over time.**
- The design system has no badge, no ring, and no content-state red.

A design system that has no red badge cannot grow one by accident.

## Your AI's work is visible

Filed, corrected, and — the part that usually goes unrecorded — **deliberately left alone**.

> *"Added Thursday's dentist appointment from your message."*
> *"Your passport expiry said 2029; the scan says 2028. Changed it."*
> *"You've moved the dentist three times. I didn't reschedule it — that looked like a decision, not a slip."*

Every line is reversible from where you read it. An agent that only shows its edits looks like one that never holds back, and the most reassuring thing a system like this can say is *"I saw this and decided not to touch it."*

## A life is a directory

The store is plain files — markdown with front matter, and your original attachments beside them.

```
life/
├── memories/2019/2019-06-nani-house.md
├── people/rumi.md
├── papers/passport.md   +   passport.pdf
└── someday/learn-to-sail.md
```

SQLite is only an index. Delete it and it rebuilds from the files.

This matters more here than in most software. The product asks you to put your life in it. If the only copy lived in a schema that needed this app to read, it would have trapped the thing it promised to keep. Files survive the project being abandoned, survive a bad migration, and survive you changing your mind. Copy the folder and you have moved house. Put it in `git` and you have a backup strategy you already understand.

## Privacy, stated precisely

Health and money are in scope, so this has to be exact rather than reassuring. There are three parts to the boundary, and we state each plainly:

1. **The OhMyLife server** stores everything on the user's own machine and initiates nothing of its own.
2. **A provider key the user configured** sends only what that feature needs, only to the provider they chose.
3. **The connected agent is outside our boundary.** Whatever it reads goes wherever that agent runs. We can show the user what was read; we cannot stop it leaving.

**So: "your data never leaves your machine" is not a claim this project makes**, because it would be false under a cloud-hosted agent, and false again the moment you configure a key.

**If you want nothing to leave your machine, point WeAllHateLife at a local model — or connect no model at all.** That is the only thing that actually delivers it, so it is what this documentation names rather than a setting that merely implies it.

**Egress guarantees, tested and proven:**
- **With no provider key configured, egress is zero** across a full MCP session, asserted automatically by tests.
- **No telemetry, no update check, no analytics, ever** — unconditional, under any configuration.
- **With a provider key configured**, the only permitted destination is the provider the user chose, for work the user asked for. Nothing else is dialled.

**Visibility tiers enforced at the tool boundary:**
- An agent asking for a **sealed area** gets **nothing** — not a filtered view whose shape it could infer from what is missing. Absence of a result and absence of the area are indistinguishable to the caller.
- `get_life_schema` tells an agent what it is currently allowed to read, so it discovers its boundaries up front rather than guessing from failures.
- `request_access` asks for an area with a reason and a duration. **Grants expire** — a permanent grant is a grant nobody revisits.
- **`propose` is the only path into a sealed area**, and it needs the person's yes. Direct creation, updates, and archiving in sealed areas are refused.
- **Revoking an area mid-session takes effect immediately**, on the very next tool call.

**An access log you can read:**
Every time an agent reads an entry, lists an area, searches, or checks what is open, that read is logged with its timestamp, tool and area in `tended/access-log/YYYY-MM-DD.md`. You can read what your agent *read*, and when — not only what it wrote.

**Your files stay plain Markdown on disk. There is no encryption inside the application, and none is planned.** A life has to outlive the software, and encrypted files are landfill without the app that wrote them. On your own machine, full-disk encryption — FileVault, BitLocker, LUKS — already handles the stolen-laptop threat, and handles it better than anything this project would write. **Disk encryption is your operating system's job**, and this README would rather say so than imply the app does it.

## Two ways to connect an AI

Both are planned for v1.0, and neither is a fallback for the other:

- **Connect the agent you already run.** WeAllHateLife is itself an MCP server, so Claude Code, Codex, opencode or anything else that speaks [MCP](https://modelcontextprotocol.io) connects to it directly. No second subscription, and no decision by us about which model you are allowed to use. This is the primary path, and it costs you nothing extra.
- **Or paste your own key into the site.** Add a provider key in WeAllHateLife itself and the built-in assistant works there, so nobody without an agent is locked out. It is your key and your provider — **this project hosts no model.** The trade is in the privacy section above: a configured key is what makes the server itself call out.

The honest half of that: **the quality of the filing is your model's, not ours.** This app is a place and a protocol; what travels over it is whatever your agent produces. Nothing has been measured.

## Themes are photographs you can swap

The design is warm and image-led — cream and parchment, deep forest green, terracotta, sage, lamplight throughout. The photographs are **data, not markup**: a theme is a folder with a manifest, a palette, and one image per slot.

**Uploading your own photo for a slot is the primary path.** *(Planned.)* Where a slot has no upload, the default is a small set of calm, category-wise images generated with an AI image tool — no bundled stock photography, and no licence to track down. Until that generated set ships, drawn placeholder scenes fill the slot instead.

Light and dark are each designed, not inverted.

## Documentation

- [Product specification](docs/SPEC.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Folder structure](docs/STRUCTURE.md)
- [Roadmap](docs/ROADMAP.md)
- [Release checklist](docs/RELEASE_CHECKLIST.md)

## Licence

MIT. See [LICENSE](LICENSE).

The MIT licence covers the code. Default theme images are generated, not stock photography, and any photo in your own life is yours.
