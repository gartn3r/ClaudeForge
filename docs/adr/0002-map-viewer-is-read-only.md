# The Map viewer never writes to the Tracker

ClaudeForge reads Maps and Tickets (GitHub Issues or local markdown) but never writes to the Tracker: claiming, resolving, closing and editing Tickets happen only through Claude Code running `/wayfinder`. Clicking a workable Ticket only opens a new Hosted session with the `/wayfinder` command prefilled. This keeps Wayfinder the single owner of its own conventions, which ClaudeForge would otherwise have to re-implement and keep in sync.

## Consequences

- Which Session works which Ticket is derived from Session history (the `/wayfinder` invocation and its arguments), not from the Tracker: a GitHub assignee names a person, not a Session.
