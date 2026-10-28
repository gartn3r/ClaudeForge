# Claude pilots the interface through a CLI only Hosted sessions can use

Until now ClaudeForge only wrapped the `claude` terminal: Claude could not act on the window around it, and the window could reach Claude only by typing into its terminal. The ClaudeForge CLI changes the first half: a Hosted session's Claude runs it, through Bash like any other command, to change an Element's properties and to add Created Elements and Content items, so its work shows beside the terminal. ClaudeForge starts every Hosted session's `claude` itself, so it hands each one, in its environment, what the CLI needs to reach this ClaudeForge and to prove which Session is asking; any other process, External sessions included, is refused. The other half does not change: ClaudeForge still reaches Claude only by typing into the Session's terminal, in view of the user.

## Considered Options

- **An MCP server added to each Hosted session at launch**: Claude would find typed tools by itself, but the same surface would not serve hooks and scripts, and it ties ClaudeForge to the MCP configuration Claude Code reads at start. Rejected for a CLI, whose use ClaudeForge explains to each Hosted session itself.
- **Open to any process on the machine**: lets External sessions and scripts drive the interface too, but anything running locally could then write into a window that drives terminals.
- **Messages to Claude outside the terminal**: rejected; the user would no longer see everything Claude is told.

## Consequences

- Every call is a Bash command, which Claude Code asks permission for unless the user allows `claudeforge` once.
- A Session that becomes an External session can no longer use the CLI.
