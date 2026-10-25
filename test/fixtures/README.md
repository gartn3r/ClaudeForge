# Test fixtures

Static data behind the shared fake environment (`test/fake-env`), which copies it into a temporary folder for each test:

- `projects/`: fixture Projects. `harbor-api` declares a GitHub Tracker, `recipe-box` a local markdown Tracker with a Map under `.scratch/`, `dotfiles` declares none.
- `claude-home/`: the Claude Code home (`CLAUDE_CONFIG_DIR`). `sessions/<project>/` holds Session histories for a fixture Project; `__CWD__` and `__CWD_JSON__` are replaced with the Project's path, and the files land in `projects/<encoded path>/` as Claude Code stores them. `sessions/<project>@<worktree>/` does the same for a git worktree of the Project, created at `<project>/.claude/worktrees/<worktree>` and linked as git links worktrees. A `*.live.json` file is a live-session registry entry, written to `sessions/<pid>.json` with `__LIVE_PID__` replaced by the test's own process id (a running `claude`) or `__DEAD_PID__` by the id of a process that has exited (an entry a crashed `claude` left behind).
- `gh/api/`: JSON the fake `gh` replays for `gh api <path>`, one file per path (`gh api repos/fixture/harbor-api` reads `gh/api/repos/fixture/harbor-api.json`).

Later tickets extend these fixtures (more Session kinds, Maps covering every Ticket state, Sub-tickets, Extensions).
