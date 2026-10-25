# Host the real Claude Code CLI in a ConPTY, on Electron

ClaudeForge runs the real `claude` CLI in a pseudo-terminal (node-pty with a bundled `conpty.dll`, rendered by xterm.js) instead of driving Claude through the Agent SDK behind a custom chat UI, so every Hosted session behaves exactly like Claude Code in a normal terminal and stays current as Claude Code evolves. We chose Electron over Tauri 2 and .NET because it is the stack VS Code's terminal already proves against Claude Code (bundled ConPTY, xterm.js as a documented Claude Code target), with a cross-platform path, at the cost of a ~160 MB install and frequent Electron majors.

## Considered Options

- **Agent SDK + custom UI**: full control over rendering, but it stops being "the Claude Code terminal" and would re-implement slash commands, permissions and the TUI.
- **Tauri 2 + portable-pty**: much smaller, same terminal quality on Windows, but a thinly maintained Rust PTY crate, more glue code, and WebKit instead of Chromium on macOS/Linux.
- **.NET WPF + Windows Terminal control**: most faithful Windows rendering, but the control is unofficial (productising it is iceboxed by Microsoft), Windows-only, and the Map graph would need WebView2 anyway.

See `docs/research/desktop-stack-terminal-and-graph.md`.
