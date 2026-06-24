# Releasing Aperture

Aperture uses a two-branch model:

- **`dev`** — all work lands here (feature branches / issue branches merge into `dev`).
  A staging deployment continuously pulls `dev` and rebuilds its containers on every commit,
  so the current state can be tested before it reaches prod. This is why `dev` is long-lived
  and allowed to diverge from `master` — it is a real QA gate, not just an integration branch.
- **`master`** — the stable, public release branch. Every tag and GitHub release points at a commit on `master`.

A release is just `dev` merged into `master`, tagged, and published. The version bump and
changelog entry are authored on `dev` **before** the merge, so the merge commit on `master`
already carries them — master never needs a follow-up "fix version" commit.

## Versioning

- Single source of truth is `version` in `package.json`.
- Tags are `v<version>` (e.g. `v1.0.0-rc.4`).
- `alpha` / `beta` / `rc` releases are GitHub **pre-releases**; the final `1.0.0` (no suffix) is a stable release.

## Steps

### 1. On `dev` — bump and changelog

```sh
git switch dev
git pull
```

- Bump `version` in `package.json`.
- Prepend a new section to `CHANGELOG.md` for the version. Group entries under
  **New features / Improvements / Fixes / Misc**, with inline `*(Author)*` attribution on
  every item (or none at all — keep it consistent). Close with a **Contributors** list.

Source material for the notes:

```sh
# commits since the last release tag
git log v<previous>..dev --no-merges --pretty=format:"%h|%an|%s"
```

Commit and push:

```sh
git add package.json CHANGELOG.md
git commit -m "Release v<version>"
git push origin dev
```

### 2. Merge `dev` into `master`

Keep the merge commit (do **not** squash — master must share history with dev so future
diffs stay clean).

```sh
git switch master
git pull
git merge --no-ff dev -m "Merge dev for v<version>"
```

### 3. Tag the master merge commit

The tag must point at the published commit on `master`, not at a dev commit.

```sh
git tag v<version>
git push origin master --follow-tags
```

### 4. Create the GitHub release

The release body is the matching `CHANGELOG.md` section — the changelog is the single source
of truth, so the release page and the changelog never drift.

```sh
# extract just this version's section into a temp file, then publish
gh release create v<version> \
  --target master \
  --title "v<version>" \
  --notes-file release-notes.md \
  --prerelease        # omit for the final stable 1.0.0
```

To slice the current top section out of `CHANGELOG.md` (everything between the first and
second `## ` heading):

```sh
awk '/^## /{n++} n==1' CHANGELOG.md | sed '1d' > release-notes.md
```

Delete `release-notes.md` once the release is published.

## Order, and why

| Step | Branch | Why this order |
|---|---|---|
| Bump version + changelog | `dev` | The version commit *is* what master receives via the merge — no separate fixup on master. |
| Merge `dev` → `master` | `master` | Master is the public branch; the merge commit is the release point. |
| Tag `v<version>` | `master` | Pins `tag == master HEAD == published commit`. Tagging on dev would point the release at a non-master commit. |
| GitHub release | — | Points at the tag, body sourced from the changelog, so the page and tag are always the same commit. |
