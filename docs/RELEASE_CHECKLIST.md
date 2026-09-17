# v1.0 release checklist

## Truth

- [ ] Every public claim has working evidence or is clearly labelled planned.
- [ ] No capability matrix, benchmark or model comparison is presented as tested unless it was tested.
- [ ] The specification, the documentation and the implementation agree.
- [ ] No demand, download, user or star figure is claimed that was not measured.

## Privacy — read every sentence, not just the section

- [ ] The server's guarantee and the connected agent's behaviour are described **separately**, everywhere they appear.
- [ ] **No sentence anywhere implies that a user's data never leaves their machine.** It would be untrue under a hosted agent, and untrue again with an in-site provider key configured.
- [ ] Every privacy claim is true under **every** supported configuration — no model connected, a local model, a hosted model over MCP, a remote agent over HTTP, and an in-site provider key.
- [ ] With no in-site provider key configured, the server makes zero outbound network calls during a full session, asserted by a test. With a key configured, the only outbound calls are to that provider's endpoint — also asserted.
- [ ] Each open privacy question from the specification is either answered and implemented, or still visibly marked open.

## The promises

- [ ] Deleting the index and restarting rebuilds it from the files with no data loss.
- [ ] An agent has no delete path. Archiving is the only removal and it is reversible.
- [ ] Every agent write carries a reason, and every reason reaches the tending record.
- [ ] The tending record shows filed, corrected **and left-alone** entries.
- [ ] Every tending line is reversible from where it is read.
- [ ] `someday` entries cannot be given a due date through any tool, and never appear in `whats_open`.
- [ ] Nothing computes a habit streak.
- [ ] A task past its date renders in the same weight as any other. No escalation.
- [ ] The component library contains no badge count, no progress ring and no content-state red.

## The product

- [ ] A fresh install with an empty volume produces a working, beautiful home page — no setup wizard, no empty-state apology.
- [ ] A real agent connects and files a memory, a person, a document and an appointment with no human typing into the website.
- [ ] The life summary contains no score, grade, ranking, percentage or progress ring.
- [ ] **"Nothing needs you today" is signed off as a designed screen.**
- [ ] Someone can wander with no task and come out having read something they had forgotten.
- [ ] Light and dark are each reviewed as designed surfaces, not a palette flip.

## Assets and licences

- [ ] **A user's own uploaded photo is theirs; the product records no licence and does not redistribute it.** Default images shipped in the repository are AI-generated for this project, and that origin is stated where they ship. Any third-party photograph shipped has its own licence recorded in its theme manifest, permitting redistribution and modification in a public MIT repository.
- [ ] Every shipped font has a licence permitting redistribution.
- [ ] Every dependency is listed with its licence.
- [ ] Any copied or adapted code is declared with its source, commit and licence — or there is none, and that is stated.

## Repository

- [ ] README, specification, architecture, structure and troubleshooting are complete and current.
- [ ] Security policy, code of conduct and contributor instructions are complete.
- [ ] Private vulnerability reporting is enabled.
- [ ] Repository description, topics and homepage are set.
- [ ] No life folder, database or personal file is tracked.
- [ ] CI passes.
- [ ] Working tree is clean and local `HEAD` matches the remote.

## Name

- [ ] The final name is settled and a trademark search has been run. The working name was never cleared.

## Launch

- [ ] A short demo shows install, connect an agent, and the agent filing something unprompted.
- [ ] Release notes and changelog are accurate.
- [ ] The tag is created only after every box above is ticked.
