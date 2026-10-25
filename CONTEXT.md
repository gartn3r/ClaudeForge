# ClaudeForge

A Windows desktop harness around Claude Code: it hosts Claude Code sessions for any project and shows, beside them, the Wayfinder planning state of that project.

## Language

### Sessions

**Project**:
The folder a Session runs in; the explorer groups Sessions by Project.
_Avoid_: workspace, repo

**Session**:
One Claude Code conversation, identified by its session id, whether finished or still running.
_Avoid_: chat, conversation, tab

**Hosted session**:
A Session whose `claude` process runs inside ClaudeForge, in its own terminal; several can run at once.

**External session**:
A Session whose `claude` process runs outside ClaudeForge (another terminal, another app); ClaudeForge can see it but not drive its terminal.

### Extensions

**Extension**:
Anything that extends Claude Code for a Session: a skill, a subagent, an MCP server or a plugin, at user (global) or Project scope.
_Avoid_: capability, tool, add-on

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

**Tracker**:
Where a project keeps its Maps and Tickets, as declared in its `docs/agents/issue-tracker.md` (GitHub Issues or local markdown under `.scratch/`).
_Avoid_: backend, provider
