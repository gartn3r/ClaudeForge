# ClaudeForge

A Windows desktop harness around Claude Code: it hosts Claude Code sessions for any project and shows, beside them, the Wayfinder planning state of that project.

## Language

### Sessions

**Project**:
The folder a Session runs in; the explorer groups Sessions by Project.
_Avoid_: workspace, repo

**Session**:
One Claude Code conversation that has run at least once in a ClaudeForge terminal (started, forked, or reached there through `/clear` or `/resume`), identified by its session id, whether finished or still running. A conversation that never ran in ClaudeForge is not a Session: ClaudeForge neither lists nor manages it, and offers no way to bring it in other than resuming it from a ClaudeForge terminal.
_Avoid_: chat, conversation, tab

**Hosted session**:
A Session whose `claude` process runs inside ClaudeForge, in its own terminal; several can run at once.

**External session**:
A Session whose `claude` process now runs outside ClaudeForge (resumed from another terminal or app); ClaudeForge still lists it but cannot drive its terminal.

### Extensions

**Extension**:
Anything that extends Claude Code for a Session: a skill, a subagent, an MCP server or a plugin, at user (global) or Project scope.
_Avoid_: capability, tool, add-on

### Shortcuts

**Shortcut**:
An entry the user keeps, in their own order, in the Shortcuts card above the Sessions; the same for every Project. It is a Web shortcut or a Skill shortcut.
_Avoid_: link (a Session's link is something else), favorite, bookmark

**Web shortcut**:
A Shortcut to a web address, opened in a Web tab.

**Skill shortcut**:
A Shortcut to a command that is typed, never sent: into the Hosted session on show when it is ready, or into a new Session of the displayed Project when no Hosted session is on show; nothing is typed while the Session on show is busy. The command is a skill chosen among the Extensions with optional arguments, or one written freely.

**Web tab**:
A tab beside the Hosted session tabs that shows a Web shortcut's page inside ClaudeForge.
_Avoid_: webview, browser tab

### Wayfinder

**Map**:
The single issue (or `map.md` file) that charts one Wayfinder effort toward its destination, indexing the decisions made and the fog still ahead.
_Avoid_: plan, tree, roadmap

**Ticket**:
A child issue of a Map, or of another Ticket, holding one question whose resolution is a decision; it is open, claimed, blocked or closed.
_Avoid_: task (a Ticket type), node, branch

**Sub-ticket**:
A Ticket whose parent is another Ticket rather than the Map. A Ticket with open Sub-tickets is a **Parent Ticket**; a block on a Parent Ticket also blocks every Ticket beneath it.
_Avoid_: child task, subtask, nested issue

**Frontier**:
The open, unclaimed Tickets with no open blocker on themselves or any ancestor and no open Sub-tickets: what can be worked now.

**Wayfinder reference**:
How a `/wayfinder` invocation names a Map or Ticket: a GitHub issue (`#12`, `owner/repo#12` or its URL), or a local effort, Ticket id or markdown path. A Parent Ticket's reference can stand where a Map's does, to work that Ticket as a Map of its own.
_Avoid_: ref, slug, link (a Session's link is what its reference resolves to)

**Tracker**:
Where a project keeps its Maps and Tickets, as declared in its `docs/agents/issue-tracker.md` (GitHub Issues or local markdown under `.scratch/`).
_Avoid_: backend, provider
