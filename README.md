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

## Architecture

- `src/main/`: the Electron main process. It creates the frameless window and exposes the backend API over IPC (`ipc.ts`).
- `src/backend/`: every service of the **typed backend API** in plain Node, with no Electron import. The main process owns all access to the machine through it. `maps/` is the Map service: Tracker detection, the local markdown adapter, and the Tracker-independent Map model with its derived states, Decided set and transitively reduced edges.
- `src/shared/api.ts`: the API's types, the pushed events and the IPC channel names, shared by every side.
- `src/preload/`: the sandboxed bridge (`window.claudeforge`) carrying only backend API channels.
- `src/renderer/`: the React interface. The Map panel draws its graph with React Flow, laid out top to bottom by dagre (`map/layout.ts`). `api.ts` turns the bridge into the typed client (`api.appState.read()`); strings come from `locales/en.json` and `locales/fr.json`, chosen from the Windows display language.
- `design/tokens.json`: the ClaudeForge design system tokens; `src/renderer/src/styles/` carries them as CSS with the design system's `cf-` components. Geist and JetBrains Mono ship as font files.

## Test

Both seams run on one shared **fake environment** (`test/fake-env`): a temporary Claude Code home with Session histories, fixture Projects (`test/fixtures/projects`), ClaudeForge's own data folder, and fake `claude` and `gh` executables first on `PATH` that record how they were called. `gh` replays JSON from `test/fixtures/gh`.

```bash
npm run test:seam1
```

Seam 1 drives the typed backend API with Vitest (`test/seam1`).

```bash
npm run test:seam2
```

Seam 2 builds the app and runs end-to-end journeys with Playwright for Electron (`test/seam2`).

CI runs both, plus lint, typecheck, the translation-file check and the third-party notices check, on Windows (`.github/workflows/ci.yml`).

## Licence

MIT, see [`LICENSE`](LICENSE). Third-party software is listed in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md); regenerate it with `npm run notices` after changing dependencies.
