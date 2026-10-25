# Research: desktop stack, terminal hosting and Map graph for ClaudeForge

- **Date:** 2026-10-25
- **Question:** Which desktop stack, terminal component and graph library should ClaudeForge use? ClaudeForge must host several live **Hosted sessions** of the real `claude` CLI in ConPTY, list every **Session** by **Project**, and draw a **Map** as an animated DAG of **Tickets**.
- **Method:** Primary sources only: official docs, GitHub repos, release notes, package registries (npm, crates.io, NuGet) and issue trackers. Version numbers and dates come from the registries and the GitHub API on the date above. Statements I could not trace to a primary source are marked **(unverified)**.

---

## TL;DR

1. **Recommended: Electron + node-pty (with `useConptyDll: true`) + xterm.js 6 + React Flow 12 + @dagrejs/dagre.** VS Code is built on exactly this stack: node-pty, xterm.js and a bundled `conpty.dll`. Claude Code's own docs treat "VS Code and similar xterm.js-based terminals" as a first-class target, so every known rendering problem already has a documented workaround. Costs: a large install (the Electron 45 win32-x64 zip alone is about 158 MB) and a new Electron major every 8 weeks.
2. **Runner-up: Tauri 2 + portable-pty + a sideloaded `conpty.dll`/`OpenConsole.exe` + xterm.js in WebView2, with the same graph stack.** The installer is much smaller and the backend is Rust. Against it: the `portable-pty` crate on crates.io has had no release since February 2025, even though fixes keep landing in the WezTerm repo. You also write more glue yourself (IPC channels, PTY plugin), and on macOS and Linux xterm.js would run in WebKit rather than Chromium.
3. **Not recommended as the primary stack: .NET (WPF/WinUI 3) + the Windows Terminal control.** It renders the most faithfully on Windows, but Microsoft says productising the embeddable control is in the "Icebox". The packages are unofficial CI repackages, the control has HWND "airspace" limits, and it is Windows-only. The graph view would need WebView2 anyway, because no native .NET graph control offers animated, modern DAG rendering.
4. **Two findings apply whatever stack you pick:**
   - **Ship a recent `conpty.dll`/`OpenConsole.exe` instead of using the inbox `kernel32!CreatePseudoConsole`.** On Windows 10 the inbox ConPTY drops mouse-tracking modes and SGR mouse input, which breaks Claude Code's fullscreen renderer. VS Code now ships its own `conpty.dll` by default.
   - **Set the Claude Code environment variables that help ConPTY hosts** (`CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT=1` and others) when spawning `claude`, and remap Shift+Enter yourself. Details are in §1.4.

---

## 1. Terminal hosting

### 1.0 What "render Claude Code correctly" requires (from Claude Code's own docs and issues)

Claude Code's **fullscreen renderer** "draws the interface on the terminal's alternate screen buffer, like `vim` or `htop`". It captures the mouse (click, drag-select, wheel) and probes the terminal for synchronized output. New users start in this renderer by default if they first used Claude Code on or after May 6, 2026 ([Fullscreen rendering](https://code.claude.com/docs/en/fullscreen)). A host therefore needs:

- **Alt-screen, SGR mouse (DECSET 1000/1002/1006) and focus events** passed through end to end.
- **DEC mode 2026 (synchronized output).** Claude Code probes for it. xterm.js added support in 6.0.0 ([release notes, #5453](https://github.com/xtermjs/xterm.js/releases/tag/6.0.0)).
- **Correct incremental cell updates.** The docs warn: "Some terminals, most commonly Windows Terminal and other ConPTY-backed hosts, coalesce these positioned writes incorrectly and leave fragments of earlier output on screen until you resize the window." The fix is `CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT=1`. Claude Code already turns this on automatically for background sessions and agent view on Windows ([Fullscreen → Troubleshooting](https://code.claude.com/docs/en/fullscreen#stale-or-misplaced-text-on-screen)).
- **Ctrl-click links:** "In the VS Code integrated terminal and similar xterm.js-based terminals, Claude Code defers to the terminal's own link handler". The host should therefore load xterm.js's web-links addon ([Fullscreen → Use the mouse](https://code.claude.com/docs/en/fullscreen#use-the-mouse)).
- **Shift+Enter.** This works without setup in Windows Terminal. VS Code needs `/terminal-setup`, which writes a keybinding ([Terminal config](https://code.claude.com/docs/en/terminal-config#enter-multiline-prompts)). Ctrl+J and `\`+Enter insert a newline in every terminal.

### 1.1 Electron + node-pty + xterm.js

| Item | Finding | Source |
|---|---|---|
| node-pty version | `latest` = **1.1.0** (2025-12-22); `beta` = 1.2.0-beta.18 (2026-10-23). Very active: about 18 betas in 2026. | npm registry; [releases](https://github.com/microsoft/node-pty/releases) |
| Windows backend | ConPTY only. winpty support was removed (1.2.0-beta.7, #868). The README says Windows 10 1809+ is required. | [README](https://github.com/microsoft/node-pty), [v1.2.0-beta.7](https://github.com/microsoft/node-pty/releases/tag/v1.2.0-beta.7) |
| Bundled ConPTY | The repo vendors `third_party/conpty/1.25.260303002/{win10-x64,win10-arm64}/{conpty.dll,OpenConsole.exe}`. The `useConptyDll` option (marked EXPERIMENTAL in the typings) uses it instead of the inbox one. `setParentWindow()` / `ConptyReparentPseudoConsole` arrived in 1.2.0-beta.17. | [repo tree](https://github.com/microsoft/node-pty/tree/main/third_party/conpty), [typings](https://github.com/microsoft/node-pty/blob/main/typings/node-pty.d.ts), [beta.17 notes](https://github.com/microsoft/node-pty/releases/tag/v1.2.0-beta.17) |
| Prebuilt binaries | Yes. The package publishes `prebuilds/<platform>-<arch>`, and `install` runs `node scripts/prebuild.js \|\| node-gyp rebuild`. It is built on **node-addon-api (N-API)**, so a single binary works across Electron versions without per-Electron rebuilds (N-API ABI stability is a Node property). | [package.json](https://github.com/microsoft/node-pty/blob/main/package.json), [scripts/prebuild.js](https://github.com/microsoft/node-pty/blob/main/scripts/prebuild.js) |
| Threading | "node-pty is not thread safe so running it across multiple worker threads in node.js could cause issues." Host all PTYs in one process, the way VS Code's pty host does (Electron main or a `utilityProcess`). | [README](https://github.com/microsoft/node-pty) |
| Recent Windows fixes | Use-after-free in ptyhandles (#922, beta.13); conpty deadlock under the debugger (#943, beta.15); CreateProcessW failures surfaced as `exit` (#934). Pinning a 1.2 beta is reasonable, since VS Code tracks them. | [releases](https://github.com/microsoft/node-pty/releases) |
| Licence | MIT | npm, README |
| Reference consumer | VS Code sets `useConptyDll` from `terminal.integrated.windowsUseConptyDll`, whose **default is `true`**, described as "Whether to use the conpty.dll (v1.25.260303002) shipped with VS Code, instead of the one bundled with Windows." | [terminalConfiguration.ts](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/terminal/common/terminalConfiguration.ts), [terminalProcess.ts](https://github.com/microsoft/vscode/blob/main/src/vs/platform/terminal/node/terminalProcess.ts) |

**xterm.js**

| Item | Finding | Source |
|---|---|---|
| Version | `latest` = **6.0.0** (2025-12-22). `beta` = 6.1.0-beta.315; 6.1 betas are what VS Code-class embedders run. MIT, about 21k stars, pushed 2026-10-13. | npm; [6.0.0 release](https://github.com/xtermjs/xterm.js/releases/tag/6.0.0) |
| 6.0 breaking changes | Canvas renderer **removed**, leaving DOM or WebGL. `windowsMode` removed (use `windowsPty`). Viewport and scrollbar rewritten. DEC 2026 synchronized output added. | [6.0.0 release](https://github.com/xtermjs/xterm.js/releases/tag/6.0.0) |
| `windowsPty` option | Set `{ backend: 'conpty', buildNumber }` so xterm.js applies its ConPTY heuristics (scrollback on row growth; reflow disabled below build 21376). | [xterm.d.ts](https://github.com/xtermjs/xterm.js/blob/master/typings/xterm.d.ts) |
| Keyboard protocols | `vtExtensions.kittyKeyboard` and `vtExtensions.win32InputMode` exist on **master / 6.1 betas only**; neither is in the 6.0.0 typings. win32-input-mode landed in PR #5603 (2026-01-10). Open bugs include non-US layouts sending the wrong VK (#6169) and IME issues with kitty mode (#6112). | [xterm.d.ts](https://github.com/xtermjs/xterm.js/blob/master/typings/xterm.d.ts), [#5603](https://github.com/xtermjs/xterm.js/pull/5603), [#6169](https://github.com/xtermjs/xterm.js/issues/6169), [#6112](https://github.com/xtermjs/xterm.js/issues/6112) |
| Addons (all MIT, released 2026-10-13) | `@xterm/addon-webgl` 0.19.0, `addon-fit` 0.11.0, `addon-unicode11` 0.9.0, `addon-unicode-graphemes` 0.4.0, `addon-ligatures` 0.10.0, `addon-web-links` 0.12.0, `addon-search` 0.16.0, `addon-serialize` 0.14.0, `addon-image` 0.9.0. Also `@xterm/headless` 6.0.0, which runs in Node. `addon-canvas` is dead (last published 2024-07). | npm registry |
| OSC hooks | `terminal.parser.registerOscHandler(ident, cb)` is public API. | [xterm.d.ts @6.0.0](https://github.com/xtermjs/xterm.js/blob/6.0.0/typings/xterm.d.ts) |

**Known xterm.js problems that matter for Claude Code**

- **WebGL glyph-atlas corruption.** Garbled glyphs in VS Code that a selection repaint fixed ([anthropics/claude-code#59915](https://github.com/anthropics/claude-code/issues/59915)). Claude Code's `/terminal-setup` now sets VS Code's `terminal.integrated.gpuAcceleration` to `"off"` "to prevent garbled text in the integrated terminal" ([Terminal config](https://code.claude.com/docs/en/terminal-config#enter-multiline-prompts)). A related xterm.js bug: clearing the shared atlas corrupted sibling terminals ([xterm.js#6014](https://github.com/xtermjs/xterm.js/issues/6014), closed 2026-07-27). **Implication:** offer a "GPU rendering off" toggle (DOM renderer) and handle `onContextLoss`.
- **WebGL context cap with many terminals.** `WebglAddon.dispose()` does not release the WebGL2 context. Past Chromium's roughly 16 live contexts per document, "a still-live terminal loses its renderer" ([xterm.js#6068](https://github.com/xtermjs/xterm.js/issues/6068), open). **Implication for parallel Hosted sessions:** attach WebGL only to the visible terminal, or give each live Session its own long-lived `Terminal` but never create and dispose WebGL addons in a loop.
- **Synchronized output at about 1 fps under continuous full-screen animation** ([xterm.js#6071](https://github.com/xtermjs/xterm.js/issues/6071), open, PR #6073).
- **Claude Code's capability gating with unknown xterm.js hosts.** In a terminal not recognised by `TERM_PROGRAM`, the DECRQM 2026 probe settles too late and DECSTBM scroll regions stay off, so scrolling uses larger frames ([anthropics/claude-code#98349](https://github.com/anthropics/claude-code/issues/98349), open, reported from Orca, an Electron + xterm.js app). `CLAUDE_CODE_FORCE_SYNC_OUTPUT=1` exists for terminals that support sync output but are not detected ([Terminal config](https://code.claude.com/docs/en/terminal-config#switch-to-fullscreen-rendering)).
- **Duplicated scrollback in the classic renderer in the VS Code terminal on Windows** ([#79896](https://github.com/anthropics/claude-code/issues/79896), closed as stale) and earlier artifact reports ([#22142](https://github.com/anthropics/claude-code/issues/22142)). The docs' remedy is the fullscreen renderer.

**Packaging, update and signing (Electron)**

- **Size:** `electron-v45.0.0-win32-x64.zip` is 158,223,852 bytes ([v45.0.0 assets](https://github.com/electron/electron/releases/tag/v45.0.0)). Electron 45 ships Chromium 156 and Node 24.22 and **dropped 32-bit Windows**.
- **Cadence:** "Electron's cadence between major version releases is 8 weeks long". "The latest three stable major versions are supported" ([timelines](https://www.electronjs.org/docs/latest/tutorial/electron-timelines)).
- **Auto-update:** update.electronjs.org is free for public GitHub repos publishing to GitHub Releases (macOS/Windows), via `update-electron-app`. Squirrel.Windows and static-storage feeds are also supported ([Updating applications](https://www.electronjs.org/docs/latest/tutorial/updates)). electron-builder's `electron-updater` is the common alternative (MIT, active: [repo](https://github.com/electron-userland/electron-builder)).
- **Code signing:** Electron Forge is recommended. All tooling goes through `@electron/windows-sign`. Azure Artifact Signing (formerly Trusted Signing) is "the cheapest option for code signing on Windows" but is country-limited ([Code signing](https://www.electronjs.org/docs/latest/tutorial/code-signing)).
- **Electron-specific Windows risk:** Claude Desktop (Electron) on NVIDIA RTX 50-series flickered until launched with `--disable-direct-composition` ([anthropics/claude-code#79220](https://github.com/anthropics/claude-code/issues/79220)). An app you package yourself can pass Chromium switches.
- **Cross-platform:** node-pty supports Linux and macOS natively (forkpty). Electron is the same Chromium everywhere, so xterm.js and WebGL behave the same on every OS.

### 1.2 Tauri 2 + Rust PTY + xterm.js in WebView2

| Item | Finding | Source |
|---|---|---|
| Tauri | **2.12.5** (2026-10-21), Apache-2.0/MIT, very active (pushed 2026-10-25). | [releases](https://github.com/tauri-apps/tauri/releases) |
| WebView | Windows uses WebView2 (Chromium, self-updating). macOS uses WKWebView, updated only with the OS. Linux uses WebKitGTK, which varies by distro. | [Webview versions](https://v2.tauri.app/reference/webview-versions/) |
| WebView2 bootstrap | Default `downloadBootstrapper` adds 0 MB; `embedBootstrapper` about 1.8 MB; `offlineInstaller` about 127 MB; `fixedVersion` about 180 MB. On Windows 10 (April 2018+) and 11, "the WebView2 runtime is distributed as part of the operating system". | [Windows installer](https://v2.tauri.app/distribute/windows-installer/) |
| `portable-pty` | **0.9.0, published 2025-02-11**, MIT, about 23M downloads. It lives in the WezTerm monorepo, where `pty/` changes continued in 2026 (kill fix 2026-06-07, winapi to windows-sys 2026-08-25) **without a crates.io release**. WezTerm's own last tagged release is 20240203. | crates.io API; [wezterm commits on pty/](https://github.com/wezterm/wezterm/commits/main/pty) |
| Sideloaded ConPTY in portable-pty | `load_conpty()` checks kernel32 first, then "We prefer to use a sideloaded conpty.dll and openconsole.exe host deployed alongside the application". Shipping both files next to the exe is enough. | [pty/src/win/pseudocon.rs](https://github.com/wezterm/wezterm/blob/main/pty/src/win/pseudocon.rs) |
| Where to get conpty.dll | Every Windows Terminal release attaches `Microsoft.Windows.Console.ConPTY.<ver>.nupkg` (1.25.260930003 in v1.25.2733.0, 2026-10-02, MIT). | [WT v1.25.2733.0 assets](https://github.com/microsoft/terminal/releases/tag/v1.25.2733.0) |
| Ready-made plugin | `tauri-plugin-pty` 0.3.1 (2026-07-08, MIT, about 52k downloads) wraps `portable-pty ^0.9.0`; JS side `tauri-pty` ([Tnze/tauri-plugin-pty](https://github.com/Tnze/tauri-plugin-pty)). It is small and single-maintainer. | crates.io API, npm |
| Alternatives | `winpty-rs` 1.0.6 (2026-06-10; despite the name it supports ConPTY), `conpty` 0.7.0 (2024-09, stale), `pty-process` 0.5.4 (Unix-oriented). | crates.io API |
| Streaming PTY output to JS | Use **Channels**: they "are designed to be fast and deliver ordered data" and are used internally for "child process output". The event system "is not designed for low latency or high throughput situations" and its payloads are JSON strings. | [Calling the frontend from Rust](https://v2.tauri.app/develop/calling-frontend/) |
| Auto-update | `tauri-plugin-updater` 2.14.0. Updates **must** be signed with a Tauri key pair ("if you lose this key you will NOT be able to publish new updates"). Supports NSIS and MSI, with a static `latest.json` on GitHub Releases generated by tauri-action. | [Updater plugin](https://v2.tauri.app/plugin/updater/) |
| Code signing | OV/EV via `tauri.conf.json`, Azure Key Vault via relic, Azure Artifact Signing via `signCommand`. "Since 2024, an EV Certificate no longer gives your app an immediate reputation with Microsoft SmartScreen." | [Windows code signing](https://v2.tauri.app/distribute/sign/windows/) |
| Size | Tauri's docs say only that it "by default provides very small binaries" with no figure ([App size](https://v2.tauri.app/concept/size/)). Typical Tauri installers are single-digit MB **(unverified)**. | |

**Assessment.** Terminal fidelity on Windows equals the Electron option: same xterm.js, same Chromium engine via WebView2, same bundled ConPTY. The extra cost is engineering: you own the PTY layer (stale crate release, small plugin), the binary IPC path, and a Rust backend. The cross-platform risk is real: xterm.js would run in WKWebView or WebKitGTK on macOS and Linux, a less-trodden path than Chromium.

### 1.3 .NET (WPF / WinUI 3 / Avalonia)

| Option | Finding | Source |
|---|---|---|
| Windows Terminal's own control (`Microsoft.Terminal.Wpf` / `TerminalControl`) | The repo contains `src/cascadia/WpfTerminalControl` and `TerminalControl`; Visual Studio embeds the WPF one. The tracking issue "Productize the WPF, UWP Terminal Controls" has been **open since 2020**, and a maintainer said the related work "is in the Icebox, which basically means we don't expect the core team to ever have the resources to get around to this". | [microsoft/terminal#6999](https://github.com/microsoft/terminal/issues/6999), [#13851](https://github.com/microsoft/terminal/issues/13851) |
| NuGet `CI.Microsoft.Terminal.Wpf` | 1.25.260303002 (2026-07-16), owner "CI2NugetRepackageTeam", **no licence or description on the listing**, about 15k downloads. Unofficial repackage. | [NuGet](https://www.nuget.org/packages/CI.Microsoft.Terminal.Wpf) |
| `EasyWindowsTerminalControl` | 1.0.38 (2026-07-16), MIT, 38 stars. WPF (.NET Framework and .NET 6+); WinUI 3 package 1.0.20-beta.1 "very alpha and very un-official". Uses the WT console host and ConPTY with GPU rendering. Can detach and reattach live terminals between controls (useful for session switching). Limits: **airspace** (its own HWND, so WPF content cannot draw over it), "relies on beta packages", no transparency. | [repo README](https://github.com/mitchcapper/EasyWindowsTerminalControl), NuGet |
| xterm.js in WebView2 + .NET ConPTY wrapper | `Microsoft.Web.WebView2` 1.0.4314.35. ConPTY wrappers: `Porta.Pty` 2.2.3 (2026-10-01, MIT, net10.0, Windows/Linux/macOS, single maintainer); Microsoft's `vs-pty.net` (MIT, last push 2024-12). | NuGet; [Porta.Pty](https://www.nuget.org/packages/Porta.Pty), [microsoft/vs-pty.net](https://github.com/microsoft/vs-pty.net) |
| Avalonia | Avalonia 12.1.4 (MIT). `Avalonia.Controls.WebView` 12.1.1 is listed **MIT**; the 11.3.x listings said it "requires Avalonia Accelerate license". No native VT terminal control from Avalonia. | [NuGet Avalonia.Controls.WebView](https://www.nuget.org/packages/Avalonia.Controls.WebView/) |

**Assessment.** The WT control gives the most faithful Windows rendering, since it is the same renderer as Windows Terminal, which Claude Code lists as Shift+Enter-ready. But it is not a supported product, it is Windows-only, and the airspace limit fights an "animated, modern" shell UI. Once you also need WebView2 for the graph, the .NET app is effectively a WebView2 host with a different backend language. That leaves the same choice as Tauri, with fewer public reference apps.

### 1.4 Cross-cutting findings for any stack

1. **Use a bundled ConPTY, not the inbox one.** Two measured reports show that the inbox Windows 10 ConPTY (`kernel32!CreatePseudoConsole`, conhost 10.0.19041) **does not forward `?1049h ?1000h ?1002h ?1003h ?1006h`** and **drops SGR mouse input**, while VS Code's bundled OpenConsole delivers them ([anthropics/claude-code#103327](https://github.com/anthropics/claude-code/issues/103327), [#99659](https://github.com/anthropics/claude-code/issues/99659)). Windows 11 26200 works. node-pty (`useConptyDll: true`), portable-pty (sideload) and EasyWindowsTerminalControl all support a bundled `conpty.dll`.
2. **Environment for spawned `claude` processes:**
   - Set `CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT=1` (ConPTY coalescing, see §1.0).
   - Consider `CLAUDE_CODE_FORCE_SYNC_OUTPUT=1` until the probe-ordering bug #98349 is fixed.
   - Set `TERM_PROGRAM=ClaudeForge` so you can report it.
   - Optionally set `CLAUDE_CODE_SCROLL_SPEED`; the xterm.js wheel sends one event per notch, as in VS Code ([Fullscreen → Mouse wheel scrolling](https://code.claude.com/docs/en/fullscreen#mouse-wheel-scrolling)).
3. **Shift+Enter on Windows is broken below the terminal.** Claude Code (Bun/libuv) on Windows cannot tell Shift+Enter from Enter, because libuv's console-to-VT translation drops `dwControlKeyState`. The report reproduced this in an Electron + xterm.js terminal with kitty protocol on ([#92771](https://github.com/anthropics/claude-code/issues/92771), open). **Workaround in the host:** intercept Shift+Enter with `attachCustomKeyEventHandler` and send `\n` (Ctrl+J), which the docs say inserts a newline in every terminal.
4. **Resize:** Claude Code's agent view kept a stale width after missed resize events under ConPTY ([#80123](https://github.com/anthropics/claude-code/issues/80123)). Debounce `fit()` and always forward the final `resize(cols, rows)` to the PTY.
5. **Session status for the explorer.** Claude Code (v2.1.295+) emits **OSC 7501 Program Status Protocol** reports when the terminal answers the support probe ([Terminal config → See session status](https://code.claude.com/docs/en/terminal-config#see-session-status-in-your-terminal); [spec rev 0.4](https://www.superlogical.com/rex/docs/build/program-status), as linked from [buildkite/osc7501](https://github.com/buildkite/osc7501)). An xterm.js host can answer the probe and consume reports via `registerOscHandler(7501, …)` to show working, blocked or done per Hosted session. Caveat: background sessions do not report, and [#101114](https://github.com/anthropics/claude-code/issues/101114) reports status not being sent in 2.1.296 even after the probe is answered.
6. **External sessions.** `claude agents --json [--all] [--cwd]` is the documented machine-readable list of live and background sessions (`cwd`, `kind`, `state`, `pid`, `status`). "The files under `~/.claude/jobs/<id>/` are not a stable interface" ([Agent view](https://code.claude.com/docs/en/agent-view)).

---

## 2. Graph and DAG visualisation for the Map

Workload: 5–60 Tickets (headroom to about 200) and "blocked by" edges, with four states and four types to style. Tickets are added and closed live, so the view needs **animated incremental relayout**, and clicking a Ticket runs an action.

### 2.1 Renderers

| Library | Version / date | Licence | Rendering, custom Ticket UI | Animation and relayout | Fit |
|---|---|---|---|---|---|
| **React Flow (`@xyflow/react`)** | 12.12.0 (2026-09-24); repo about 39k stars, pushed 2026-10-22 | **MIT** ("open-source MIT-licensed software, and it will be forever"). Paid **Pro** subscription ($169/$289 per month) gates *examples* only, including "Auto Layout", "Dynamic Layouting" and "Node Position Animation". | Nodes are **React components (DOM)**: arbitrary HTML/CSS, badges, Tailwind, icons. Ideal for a "modern" look at 5–200 nodes. | **No built-in layout** ("We have not implemented our own layouting solution yet") and no built-in position tweening. You compute layout (dagre, ELK, d3-dag) and animate positions yourself (rAF interpolation or CSS transforms). | Any web stack (Electron, Tauri, WebView2). [pro](https://reactflow.dev/pro), [layouting](https://reactflow.dev/learn/layouting/layouting), [examples](https://reactflow.dev/examples) |
| **AntV G6 v5** | 5.1.1 (2026-05-08); about 12k stars, pushed 2026-10-22 | MIT | Canvas/SVG via AntV G. React nodes through `@antv/g6-extension-react` 0.2.7. | **Built-in** enter, exit and update animations (`fade`, `translate`) configured on the graph or per element. Built-in `dagre` and `antv-dagre` layouts. Layouts can run in **Web Workers** (`enableWorker`); WASM dagre via `@antv/layout-wasm`. | Any web stack; framework-agnostic. [layouts](https://g6.antv.antgroup.com/en/manual/layout/overview), [animation](https://g6.antv.antgroup.com/en/manual/animation/animation) |
| **Cytoscape.js** | 3.34.4 (2026-10-15); about 11k stars | MIT (core and first-party extensions) | Canvas with stylesheet-driven nodes (shapes, labels, images). Rich HTML cards need third-party overlays. A WebGL renderer is a **preview** since 3.31, aimed at large graphs. | `cytoscape-dagre` 4.0.1 (bundles dagre v3) has `animate`, `animationDuration`, `animateFilter`, `animationEasing`: animated relayout is a one-liner. ELK and Klay extensions also exist. | Any web stack. [site](https://js.cytoscape.org/), [dagre ext](https://github.com/cytoscape/cytoscape.js-dagre), [WebGL preview](https://blog.js.cytoscape.org/2025/01/13/webgl-preview/) |
| **Sigma.js** | 4.0.3 (2026-10-15; v4.0.0 2026-10-08 is a "complete rewrite" of the programs system, WebGL2 only) | MIT | WebGL nodes via shader "programs". | Built for thousands of nodes. The graphology ecosystem has force, ForceAtlas2, noverlap and tree layouts but **no layered/Sugiyama layout**. | Overkill and the wrong shape for a small DAG. [release](https://github.com/jacomyal/sigma.js/releases/tag/sigma%404.0.0) |
| **vis-network** | 10.1.2 (2026-08-19) | Apache-2.0 OR MIT | Canvas, limited node templating. | Built-in `layout.hierarchical` with `sortMethod: 'directed'`; physics-based motion. Hierarchical mode "overrules some of the other options". | Works, but dated look. [layout docs](https://visjs.github.io/vis-network/docs/network/layout.html) |
| **Reaflow** | 5.4.1 (2025-04-08); repo last pushed 2025-06-04 | Apache-2.0 | React diagram editor on ELK. | No animation mentioned. | **Maintenance risk:** no activity in about 16 months. [repo](https://github.com/reaviz/reaflow) |
| **D3 + d3-dag** | d3-dag 1.2.2 (2026-07-05) | MIT | Whatever you draw (SVG). | Layout only (see below). Full control, but you build interaction and animation yourself. | Possible, but more work than React Flow plus d3-dag as a layout engine. |

### 2.2 Layout engines

| Engine | Version / date | Licence | Notes | Source |
|---|---|---|---|---|
| **@dagrejs/dagre** | 3.1.3 (2026-10-24); v2.0.0 2025-11 modernised the build (ESM), v3.0.0 2026-03. Active again. | MIT | Sync, small, fast Sugiyama. React Flow: "Dagre is a simple library for layouting directed graphs", bundle about 40 KB; caveat about sub-flows. **No incremental or stable mode.** | npm; [releases](https://github.com/dagrejs/dagre/releases); [React Flow layouting](https://reactflow.dev/learn/layouting/layouting) |
| **d3-dag** | 1.2.2 (2026-07-05) | MIT | Sugiyama, Zherebko and Grid. Quality presets: "fast" is about 4x faster than dagre v3 on a 184-node graph; "medium" is about 2x slower but better. Every node needs a positive width and height. | [README](https://github.com/erikbrinkman/d3-dag) |
| **ELK.js** | 0.12.0 (2026-07-17) | **EPL-2.0 OR GPL-3.0-or-later** (npm). The repo LICENSE is EPL-2.0: weak copyleft, fine to bundle unmodified in an MIT app, but note it. | Most configurable; orthogonal edge routing; async; runs in a Web Worker (`workerUrl`). Bundle about 1.4 MB. Stability options for incremental updates: `considerModelOrder.strategy`, `crossingMinimization.semiInteractive`, `interactiveReferencePoint`, `interactiveLayout`. React Flow: "We don't often recommend elkjs" (complexity). | npm; [README](https://github.com/kieler/elkjs); [ELK Layered reference](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html) |
| **MSAGL / msagljs** | .NET `MSAGL.WpfGraphControl` 1.2.1 (2024-12); `AutomaticGraphLayout` 1.1.12 (2021). JS `@msagl/core` 1.1.24 (2026-04). | MIT | Strong layered layout and edge routing, but the WPF viewer is static and old-school. The JS port is low-traffic (175 stars). | NuGet; [microsoft/automatic-graph-layout](https://github.com/microsoft/automatic-graph-layout); [microsoft/msagljs](https://github.com/microsoft/msagljs) |

### 2.3 Native .NET options

- **MSAGL WPF control** (above): credible layout, dated visuals, no animation.
- **Nodify** 7.3.0 (WPF) and **Nodify.Avalonia** 2.0.0 (both MIT; [miroiu/nodify](https://github.com/miroiu/nodify), about 2k stars, active). A node-editor control with no automatic DAG layout; you would pair it with MSAGL for positions.
- **AvaloniaGraphControl** 0.8.0 ([Oaz/AvaloniaGraphControl](https://github.com/Oaz/AvaloniaGraphControl)): small, built on MSAGL.

None of these matches React Flow or G6 for animated, styled, incremental DAG views, so even a .NET shell would most likely host the Map in WebView2.

### 2.4 Incremental relayout: what to actually build

None of the layered engines animates by itself except G6 (built-in transitions) and Cytoscape (`animate: true` on the layout). With React Flow, run layout on every Map change, then tween each Ticket from its old position to its new one. Fade new Tickets in from their blocker's position and closed Tickets out. To limit "jumping":
- with **dagre**, feed nodes and edges in a stable order (for example Ticket creation order); there is no explicit incremental mode;
- with **ELK**, use `considerModelOrder` or the semi-interactive crossing minimisation with previous positions as hints (options above).

---

## 3. Recommendation (ranked)

### #1: Electron + node-pty + xterm.js + React Flow + dagre (ELK.js as the upgrade path)

- **Terminal:** `node-pty` 1.1.x, or a pinned 1.2.0 beta, in a dedicated pty host (Electron `utilityProcess` or main). Spawn with `useConpty: true, useConptyDll: true`. xterm.js 6.x with:
  - WebGL on the **visible** terminal only, DOM fallback, `onContextLoss` handling;
  - fit, unicode11 or graphemes, web-links, search, and serialize (to snapshot hidden sessions);
  - `windowsPty: { backend: 'conpty', buildNumber }`;
  - a Shift+Enter → `\n` key handler, an OSC 7501 handler, and the env vars in §1.4.
  - Track 6.1 betas for `win32InputMode` and `kittyKeyboard` once stable.
- **Graph:** React Flow 12 with custom React Ticket components (state colour, type icon, claimed or blocked badge) and `@dagrejs/dagre` for layered layout (sync, about 40 KB, MIT). Animate position changes in your own code; the Pro examples are optional reference code, not needed features. Switch to ELK.js in a Web Worker if you want orthogonal edge routing or better stability across updates (accept the EPL-2.0 dependency). d3-dag is a drop-in alternative to dagre if crossings look bad.
- **Why it wins:**
  - It reproduces VS Code's terminal stack (node-pty + xterm.js + bundled `conpty.dll`, default `true`), the xterm.js environment Claude Code most explicitly documents and works around.
  - N-API prebuilds avoid native rebuild pain.
  - The same Chromium runs on Windows, macOS and Linux.
  - Free update.electronjs.org works for a public GitHub repo.
  - React Flow gives the most flexible "modern" Ticket rendering.
- **Costs:** about 150 MB+ bundle and higher RAM; Electron majors every 8 weeks with three supported; you must keep node-pty and xterm.js current.

### #2: Tauri 2 + portable-pty (sideloaded ConPTY) + xterm.js + React Flow + dagre

Choose this if installer size, memory and a Rust backend matter more than reusing VS Code's proven Node pieces. The terminal fidelity on Windows is the same (WebView2 is Chromium). Budget for:
- vendoring or forking `portable-pty` from WezTerm `main`, because the crates.io release dates from February 2025;
- shipping `conpty.dll` and `OpenConsole.exe` from the `Microsoft.Windows.Console.ConPTY` nupkg;
- streaming bytes over Tauri Channels;
- Tauri's mandatory updater key;
- WebKit testing of xterm.js if macOS and Linux follow.

### #3: .NET WPF + EasyWindowsTerminalControl, with the Map in WebView2

Only if Windows-only and C# are firm requirements. You get Windows Terminal's real renderer and live detach and reattach. You also depend on an unofficial repackage of a control Microsoft has iceboxed, and HWND airspace limits the layout. The graph still lives in WebView2, so you end up with two UI technologies.

### What would change the ranking

- If Microsoft ships an official embeddable WinUI 3 Terminal control (microsoft/terminal#6999), option #3 improves sharply.
- If `portable-pty` gets a fresh crates.io release, or a maintained Tauri PTY plugin appears, the gap between #1 and #2 narrows to "size versus ecosystem".
- If Claude Code fixes Windows Shift+Enter (#92771) or the ConPTY probe ordering (#98349), some host-side workarounds become unnecessary. Re-check before release.

---

## Open questions and unverified items

- Real installed sizes and RAM for an Electron versus a Tauri build of ClaudeForge were not measured; only the Electron runtime zip size is sourced.
- Whether React Flow's free tier is enough for smooth position animation at 60 nodes was not prototyped. It is a good candidate for a `/prototype`.
- The OSC 7501 spec is cited via a third-party implementation's link (superlogical.com, rev 0.4), not fetched directly.
- The SmartScreen guidance conflicts: Electron's docs say Azure Artifact Signing "gets rid of SmartScreen warnings", while Tauri's say EV and OV certificates now build reputation the same way. Expect some SmartScreen friction on early releases either way.
