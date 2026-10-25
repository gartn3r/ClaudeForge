# Test fixtures

Static data behind the shared fake environment (`test/fake-env`), which copies it into a temporary folder for each test:

- `projects/`: fixture Projects. `harbor-api` declares a GitHub Tracker, `recipe-box` a local markdown Tracker with a Map under `.scratch/`, `dotfiles` declares none.
- `claude-home/`: the Claude Code home (`CLAUDE_CONFIG_DIR`). `sessions/<project>/` holds Session histories for a fixture Project; `__CWD__` and `__CWD_JSON__` are replaced with the Project's path, and the files land in `projects/<encoded path>/` as Claude Code stores them.
- `gh/api/`: JSON the fake `gh` replays for `gh api <path>`, one file per path (`gh api repos/fixture/harbor-api` reads `gh/api/repos/fixture/harbor-api.json`).

Later tickets extend these fixtures (more Session kinds, Maps covering every Ticket state, Sub-tickets, Extensions).
