# Sub-tickets: parents are never on the Frontier, blocks inherit, local markdown uses a Parent: line

Wayfinder charts Tickets as flat children of a Map, but GitHub sub-issues (and running Wayfinder on a Ticket) produce Tickets with their own Sub-tickets, nested several levels deep. ClaudeForge treats a Ticket with open Sub-tickets as a Parent Ticket that is never on the Frontier (its Frontier is its descendants'), and a block on any ancestor blocks every Ticket beneath it, so the Frontier only ever offers work that can really start. The Map panel shows one level at a time in the graph (Parent Tickets as stacks with a roll-up, opened by drilling in, with a breadcrumb back) plus a Tree view of the whole hierarchy.

For local markdown, where Wayfinder has no nesting convention, a Sub-ticket stays in the flat `issues/` folder with the Map's single numbering and carries a `Parent: NN` line, next to `Type:`, `Status:` and `Blocked by:`. The convention is declared in the project's `docs/agents/issue-tracker.md` ("Wayfinding operations"), which Wayfinder already reads, because ClaudeForge never writes to a Tracker (ADR 0002).

## Considered Options

- **Nested folders** (`issues/01-x/issues/…`): the hierarchy shows in the file tree, but `Blocked by:` across levels becomes ambiguous and renumbering a subtree breaks references.
- **Parents on the Frontier like any other Ticket**: simpler, but it offers a Ticket whose answer depends on Sub-tickets nobody has resolved yet.
