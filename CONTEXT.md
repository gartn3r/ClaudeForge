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

### Window

**App title**:
The name at the top left of the title bar, set as the wordmark: "ClaudeForge" until the user renames it in place. It is the same for every Project and lasts across restarts; a blank one gives back "ClaudeForge". It is always words only, never an icon, and it is not an Element's title: restoring the Default layout keeps it.
_Avoid_: logo, brand, window title

### Shortcuts

**Shortcut**:
An entry the user keeps, in their own order, in the Shortcuts card above the Sessions; the same for every Project. It is a Web shortcut or a Skill shortcut.
_Avoid_: link (a Session's link is something else), favorite, bookmark

**Web shortcut**:
A Shortcut to a web address, opened in a Web tab.

**Skill shortcut**:
A Shortcut to a command that is typed, never sent: into the Hosted session on show when it is ready, else into a new Session of the displayed Project. The command is a skill chosen among the Extensions with optional arguments, or one written freely.

**Web tab**:
A tab beside the Hosted session tabs that shows a Web shortcut's page inside ClaudeForge.
_Avoid_: webview, browser tab

**Sign-in popup**:
A window a Web tab's page opens with `window.open` and window features, as a site's "Continue with Google" does; it opens in a ClaudeForge window, isolated like the Web tab, and stays the page's own so the sign-in completes there. Every other new window a page asks for opens in the default browser.
_Avoid_: popup window, auth window

### Piloting

**ClaudeForge CLI**:
The command through which a Hosted session's Claude drives ClaudeForge's interface: it creates and closes Created Elements, changes an Element's properties, and adds or removes Content items. Only Hosted sessions can use it. ClaudeForge never reaches Claude unasked other than by typing into a Session's terminal, in view.
_Avoid_: headless mode, API, bridge

**Element**:
A container of the interface with an identifier (a panel, a Panel tab, a card, a menu), so that the user, by hand or through Claude and the ClaudeForge CLI, can name it, change its properties and add Content items to it. Its properties are a closed list: visible or hidden, collapsed or expanded, width, order, title, text colour and background colour (any colour). What a Session's terminal or a Map shows is never an Element's content. ClaudeForge's own Elements have fixed identifiers and one set of properties for the whole of ClaudeForge. A Panel tab takes every kind of Content item; a card takes texts, links, files (as links) and actions; a menu takes links and actions only. An Element that is created comes to the front; one whose content changes only shows a mark, unless the change asks for it to be shown.
_Avoid_: widget, component

**Created Element**:
An Element added by the user or through the ClaudeForge CLI, only where ClaudeForge provides for it: a Panel tab in the Right panel, a card in the explorer, a menu in the title bar. Its creator names it, uniquely within its Project. It belongs to that Project, shows only while that Project is displayed, can be changed only by that Project's Sessions, and lasts until it is closed. ClaudeForge's own panels and columns are never created.

**Content item**:
One thing in an Element, with its own identifier there: a text, a link, a file, a web page or an action. Adding a Content item under an identifier already used replaces it; any other is added after the rest. A file shows as it is on disk now, or as missing. An action is a command typed, never sent, as a Skill shortcut's is; it belongs to the Project, not to the Session that made it. The user can add every kind by hand. When two Sessions write the same Content item, the last one wins, and the item names the Session that last wrote it. A link or an action can be kept as a Shortcut, which copies it; the two then live apart.
_Avoid_: block, widget, entry

**Default layout**:
The arrangement of Elements ClaudeForge starts with. Restoring it gives ClaudeForge's own Elements back all their original properties, colours included; Created Elements keep their titles and colours but are shown and expanded again. Nothing is removed: Created Elements are closed one by one.

**Right panel**:
The column on the right of the Hosted sessions, holding Panel tabs in its header. Without a Map it opens on the first other Panel tab; it collapses on its own only when the displayed Project has neither a Map nor any other Panel tab.

**Panel tab**:
A tab of the Right panel. One is the Map Panel tab, first until the user moves it; the others are Created Elements. Each moves among the others by drag and drop.
_Avoid_: tab alone (a Web tab or a Hosted session's tab is something else)

### Backlog

**Work item**:
An item of the user's Azure DevOps backlog, of any type (user story, bug, task…), identified by its number.
_Avoid_: ticket (a Wayfinder Ticket is something else), issue

**Current sprint**:
The iteration, under the configured iteration root, whose dates contain today; between two sprints, the next one to start.
_Avoid_: iteration alone, current iteration

**Work items card**:
A card in the explorer, above the Sessions, listing the Work items of the configured area in the Current sprint that are unassigned or assigned to the user and neither done nor removed; the same for every Project. It refreshes when a Project is displayed and when the user asks, never on its own otherwise. A Work item's title opens it in a Web tab.
_Avoid_: backlog card, tickets card

**Work item action**:
A button beside each Work item in the Work items card, with the label the user gave it: it types a command, never sent, into a new Session of the displayed Project. The command is a skill chosen among the Extensions followed by a fixed text that can name the Work item (its number, title, type, address). There is always at least one, empty until the user sets it, and at most three; they are the same for every Project. The first is always lime; each of the others has a colour the user picks.
_Avoid_: ticket button, Skill shortcut (which types into the Hosted session on show)

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
