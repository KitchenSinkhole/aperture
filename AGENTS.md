# Aperture — Agent Working Notes

Aperture is a collaborative, real-time wormhole-mapping web app for EVE Online, built on
Next.js + TypeScript + Drizzle + Postgres.

**The working conventions for all agents live in [CLAUDE.md](CLAUDE.md)** — stack and
architectural rules, the database schema conventions, the three mutation pathways, auth/ESI
rules, and the companion-`.md` standing instruction (every `.ts`/`.tsx` edit updates its
companion `.md` in the same commit). Read it before making changes; this file intentionally
does not duplicate it.

## Branching — literal commands

```
git checkout dev && git pull
gh issue develop <issue-number> --base dev
```

Never branch off `master`. `master` only updates by merging `dev` into it on a release cut —
a PR opened against `master` from anything but `dev` is rejected by CI
(`.github/workflows/guard-master.yml`). Target `dev` in every PR.

## Scope

**Do not refactor or reformat outside the issue's scope.** Touch only the files the change
requires. No drive-by renames, no reformatting files you didn't need to edit, no "while I'm
in here" cleanup. CI enforces a diff-size limit and flags files outside the issue's declared
scope — an over-scope PR will be blocked, not just discouraged.

## Comments and logging

Match `CLAUDE.md`'s style rule exactly: no comments that explain *what* code does — naming
carries that. Only comment a non-obvious *why* (a constraint, an invariant, a workaround for a
specific bug). Don't add `console.log`/debug logging left over from development; use the
existing `pino` logger (see `src/lib/jobs/runner.md` for an example) only where the codebase
already logs at that layer.

## Config over hardcoding

App constants belong in `aperture.config.ts` or a typed env var — never a new `.ini`-style
file, never a magic number inline where a named constant reads better. Exception: things that
are deliberately fixed, not configurable, per `CLAUDE.md` (e.g. `LOCATION_POLL_ONLINE_MS`) —
those are hard-coded constants on purpose; don't turn them into runtime config.

## Closing the issue

Every PR body must include `Closes #<issue-number>`. If it's missing, a bot will try to infer
it from the branch name or PR title/body and inject it — but don't rely on that; write it
yourself.
