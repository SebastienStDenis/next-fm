# Design docs conventions

Every document in this folder follows these rules; apply them to any new doc you
write here.

- **Filename**: prefix with the date the doc was written, ISO format:
  `YYYY-MM-DD-<short-kebab-title>.md` (e.g. `2026-07-06-playlist-plan.md`).
- **Byline**: immediately under the H1 title, one italic line stating the date and
  author: `*Written YYYY-MM-DD by <author>.*` For docs written by Claude, name the
  model (e.g. `Claude (Fable 5)`).
- **References**: link docs by their full dated filename (`docs/2026-07-06-...md`).
  When renaming or adding a doc, update references across the repo (root `CLAUDE.md`,
  code comments/docstrings, other docs).
