# ClaudeForge

A Windows desktop harness around the real Claude Code CLI: Hosted sessions in terminal tabs in the centre, every Session grouped by Project on the left with the Extensions menu under it, and the Project's Wayfinder Map as an animated graph on the right. The spec is [issue #1](https://github.com/gartn3r/ClaudeForge/issues/1); the vocabulary is in [`CONTEXT.md`](CONTEXT.md) and the decisions in [`docs/adr/`](docs/adr/).

## Develop

Requires Node.js 24 on Windows.

```bash
npm install
```

```bash
npm run dev
```

## Sub-tickets in a Project's Tracker

A Ticket can have Sub-tickets, several levels deep. The Map panel shows a Ticket with open Sub-tickets as a Parent Ticket: a stack with a roll-up of everything beneath it, never on the Frontier, that opens on a click to show its Sub-tickets. A block on a Parent Ticket blocks every Ticket beneath it ([ADR 0004](docs/adr/0004-sub-tickets.md)).

On GitHub, a Ticket's Sub-tickets are its own sub-issues; nothing needs declaring. Wayfinder's local markdown convention has no nesting, so a Project using it declares one: add this paragraph to the "Wayfinding operations" section of its `docs/agents/issue-tracker.md`, which Wayfinder reads. ClaudeForge itself never writes to a Tracker ([ADR 0002](docs/adr/0002-map-viewer-is-read-only.md)).

```markdown
- **Sub-ticket**: a ticket may be split into sub-tickets, nested as deep as needed. A sub-ticket is an ordinary ticket file in the same flat `issues/` folder, numbered in the map's single sequence, with a `Parent: NN` line next to `Type:`, `Status:` and `Blocked by:`, naming the number of the ticket it belongs to. A ticket with open sub-tickets is a parent ticket: it is never on the frontier (its frontier is its sub-tickets'), and an open blocker on it blocks every ticket beneath it. Once its sub-tickets are all resolved, it is worked like any other ticket. The frontier query drops any ticket with an open sub-ticket or with an open blocker on itself or on any of its parents.
```

## Architecture

- `src/main/`: the Electron main process. It creates the frameless window and exposes the backend API over IPC (`ipc.ts`).
- `src/backend/`: every service of the **typed backend API** in plain Node, with no Electron import. The main process owns all access to the machine through it. `session-host.ts` runs each Hosted session's `claude` in a pseudoconsole (node-pty with the `conpty.dll` and `OpenConsole.exe` it ships), every PTY in that one process. `updates.ts` looks for ClaudeForge's own updates through the updater the main process gives it (electron-updater on GitHub releases, in an installed ClaudeForge only). `maps/` is the Map service: Tracker detection, the local markdown and GitHub adapters, and the Tracker-independent Map model: a tree of Tickets and Sub-tickets with their derived states (Parent Tickets, inherited blocks), roll-ups, Decided set and transitively reduced edges per level.
- `src/shared/api.ts`: the API's types, the pushed events and the IPC channel names, shared by every side.
- `src/preload/`: the sandboxed bridge (`window.claudeforge`) carrying only backend API channels.
- `src/renderer/`: the React interface. `terminal/hosted-terminal.ts` wires one Hosted session to xterm.js (WebGL renderer unless GPU rendering is off, Shift+Enter sent as a newline). The Map panel draws its graph with React Flow, laid out top to bottom by dagre (`map/layout.ts`). `api.ts` turns the bridge into the typed client (`api.appState.read()`); strings come from `locales/en.json` and `locales/fr.json`, chosen from the Windows display language.
- `design/tokens.json`: the ClaudeForge design system tokens; `src/renderer/src/styles/` carries them as CSS with the design system's `cf-` components, in the Bento design (cream, slate and lime tiles). Fraunces, Inter and JetBrains Mono ship as font files.

## Test

Both seams run on one shared **fake environment** (`test/fake-env`): a temporary Claude Code home with Session histories, fixture Projects (`test/fixtures/projects`), ClaudeForge's own data folder, and fake `claude` and `gh` executables first on `PATH` that record how they were called. `gh` replays JSON from `test/fixtures/gh`.

```bash
npm run test:seam1
```

Seam 1 drives the typed backend API with Vitest (`test/seam1`).

```bash
npm run test:seam2
```

Seam 2 builds the app and runs end-to-end journeys with Playwright for Electron (`test/seam2`). The same journeys run against a packaged ClaudeForge when `CLAUDEFORGE_EXECUTABLE` names it; `test/packaged` adds those only a packaged one can take (see Package and release).

CI runs both, plus lint, typecheck, the translation-file check and the third-party notices check, on Windows (`.github/workflows/ci.yml`).

## Package and release

```bash
npm run package
```

builds the Windows installer into `dist/` with electron-builder (`electron-builder.config.mjs`): a one-click installer for the current user, with node-pty's `conpty.dll` and `OpenConsole.exe` unpacked beside the app ([ADR 0001](docs/adr/0001-real-claude-cli-in-conpty-on-electron.md)).

```bash
npm run test:packaged
```

runs the packaged journeys (`test/packaged`) against the `ClaudeForge.exe` that `CLAUDEFORGE_EXECUTABLE` names, for instance `dist/win-unpacked/ClaudeForge.exe`. CI builds the installer on every pull request, installs it on a fresh Windows machine, starts a Hosted session in it, and has it update itself to a later build it serves locally.

The installed app looks for a newer release on GitHub releases when it starts and every four hours, downloads it in the background, shows "Update ready" in the title bar, and installs it once the user closes ClaudeForge (electron-updater). How each check went is written to `%APPDATA%\ClaudeForge\logs\updates.log`. Once signed, the app installs only updates signed by the same publisher.

Releases are published by `.github/workflows/release.yml`, only when a version tag is pushed: bump `version` in `package.json`, merge, then `git tag v<version>` and `git push origin v<version>` on that commit. The workflow uploads the installer to a draft release, installs it and starts a Hosted session in it, then publishes the release. Running the workflow by hand builds, signs and checks the installer without publishing anything. Code signing switches on when its secrets are set, with Azure Artifact Signing (`AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` secrets; `AZURE_SIGNING_ENDPOINT`, `AZURE_SIGNING_ACCOUNT`, `AZURE_SIGNING_PROFILE`, `AZURE_SIGNING_PUBLISHER` variables) or a certificate file (`CSC_LINK`, `CSC_KEY_PASSWORD` secrets). Without them, a pull request's build says it skipped signing and stays unsigned, and a tag release fails, unless the repository variable `ALLOW_UNSIGNED_RELEASE` is `true`.

## Licence

MIT, see [`LICENSE`](LICENSE). Third-party software is listed in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md); regenerate it with `npm run notices` after changing dependencies.
