# AGENTS.md — pocketstation-io/sdk-js

## Code writing standard — MANDATORY

Before writing any code, read `docs/standards/CODE_PROTOCOL.md`.
All 14 laws apply to this repo. TypeScript specifics: interface/type field alignment,
unit suffixes (`latencyMs`, `gainDb`), no empty interfaces, cross-language vocab identical to Rust.
No code ships until it passes the checklist at the bottom of that document.

---

## 🐞 NON-TRIVIAL BUG → EMPIRICAL DEBUGGING FRAMEWORK (MANDATORY)

When a defect's cause is NOT obvious from reading, OR a first obvious fix didn't
move the number, OR it's intermittent / "works sometimes" / cross-service — STOP
and apply the Empirical Debugging Framework. This binds **every agent and every
sub-agent** for the whole life of the defect. If you spot such a bug you are bound
by it: localize and record it, then fix it under this method or hand back the
reproduction + ruled-out list. Never paper over it, and never ship a guess for a
hard bug.

Core loop: **research prior art first → corner the bug repo→scope→file→function→lines
→ prove it by removing/swapping the suspect component (show it working WITHOUT the
suspect, then reintroduce one variable at a time) → fix the real lines → no fix
lands without a test that moves the original symptom metric on the real path →
record every ruled-out cause.**

**Proportionality — do NOT over-apply:** for an obvious bug you can SEE (typo,
missing await, off-by-one, wrong constant, missing import), just fix it directly +
a test. Running the full ceremony on a one-liner is itself an anti-pattern — token
burn and over-engineering that defeats the purpose. Escalate the instant an
"obvious" fix fails or you start guessing. Full method:
`docs/standards/EMPIRICAL_DEBUGGING_FRAMEWORK.md` in the parent factory repo.

---


## Source of truth

Before editing, read:

1. `docs/architecture/pocketstation-v3.0.md`
2. `docs/REPO_CONTRACT.md`
3. Relevant ADRs in `docs/adr/`
4. The assigned GitHub issue

## Phase gate

This repo activates in **Phase 5**.

If the current project phase is earlier, do not implement code here unless the issue has `phase-exception-approved`.

## Rules

- One issue = one branch = one PR.
- Do not edit unrelated repos.
- Do not create `pocketstation-io/protocol` before Phase 2.
- Do not change v3.0 architecture unless explicitly assigned.
- Do not add dependencies without approval.
- Do not bypass CI.

## Engineering Standards

Before code changes, every agent must read:

- `docs/standards/STAFF_ENGINEERING_BAR.md`
- `docs/standards/STRUCTURE_NAMING_STYLE_THINKING.md`
- `docs/standards/PRODUCTION_ENGINEERING_BAR.md`
- `docs/REPO_CONTRACT.md`
- relevant ADRs
- current phase progress file
- `FAKE_SCAFFOLD_INVENTORY.md`

All code follows the structure, naming, documentation, test naming,
comment style, and thinking process defined there.

Every non-trivial implementation documents:
- invariant
- ownership model
- failure behavior
- test coverage
- phase scope
- what is intentionally not implemented

Every PR that introduces a fake/mock/scaffold adds a row to
FAKE_SCAFFOLD_INVENTORY.md. Every PR that replaces one burns
the row down.