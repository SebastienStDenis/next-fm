#!/usr/bin/env sh
# Render pre-deploy: runs once per deploy, before the new version goes live.
# A script (not an inline "a && b") because Render wraps preDeployCommand in its
# own sh -c, so inline quoting/chaining collides. Keep it forward-only.
set -e

uv run alembic upgrade head
uv run python -m app.seed
