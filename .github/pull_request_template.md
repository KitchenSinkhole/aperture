<!--
Closing keywords only fire when the PR merges into the repository's default
branch. Keep the line below even if that is still `master` — the link is
useful either way, and it starts closing issues automatically once the
default branch moves to `dev`.
-->

Closes #

## What changed

<!-- One or two sentences. The commit messages carry the detail. -->

## Why

<!-- The problem being solved, not a restatement of the diff. -->

## Verification

- [ ] `pnpm typecheck`
- [ ] `pnpm lint`
- [ ] `pnpm test`
- [ ] Companion `.md` files are accurate for every `.ts` / `.tsx` touched
- [ ] Checked by hand in a running app where the change is user-visible

<!--
DB-backed suites are opt-in and need a provisioned database:

  docker compose up -d
  pnpm db:migrate
  RUN_DB_TESTS=1 pnpm test

They are not part of the CI check. See CONTRIBUTING.md.
-->

## Anything a reviewer should look at first

<!-- Delete if nothing. A tricky path, a decision you are unsure about, a
     behaviour with no automated guard. -->
