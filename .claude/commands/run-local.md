---
description: Start this worktree's app stack on free ports and open web + Mailpit
disable-model-invocation: true
allowed-tools: Bash(bash *), Bash(git rev-parse *)
---

The stack has already been started by the command below (this ran before you
were invoked, so the work is done). Do NOT run any further commands.

```!
bash "$(git rev-parse --show-toplevel)/scripts/run-local.sh"
```

Reply with a single short line pointing at the web URL from the output above.
Nothing else.
