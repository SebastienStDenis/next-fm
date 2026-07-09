# Docs conventions

Two kinds of documents live here:

- `design/` - dated design docs (plans, runbooks). One-shot documents that
  record a decision or plan as of a date.
- The folder root - living reference docs (e.g. `wording.md`) that are kept up
  to date as the product changes.

Rules for design docs; apply them to any new doc you write in `design/`.

- **Filename**: prefix with the date the doc was written, ISO format:
  `YYYY-MM-DD-<short-kebab-title>.md` (e.g. `2026-07-06-playlist-plan.md`).
- **Byline**: immediately under the H1 title, one italic line stating the date and
  author: `*Written YYYY-MM-DD by <author>.*` For docs written by Claude, name the
  model (e.g. `Claude (Fable 5)`).
- **References**: link docs by their full path (`docs/design/2026-07-06-...md`).
  When renaming or adding a doc, update references across the repo (root `CLAUDE.md`,
  code comments/docstrings, other docs).

Living reference docs carry the same byline (use the date of the last rewrite)
and are referenced by their full path (`docs/wording.md`).
