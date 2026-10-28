# List and manage only the Sessions that ran in ClaudeForge

ClaudeForge lists and manages only the conversations that have run at least once in one of its terminals (started, forked, or reached through `/clear` or `/resume` there), not the whole of Claude Code's history; conversations from the CLI, Claude Desktop or any other app stay out, with no import. Claude Code's history cannot tell them apart afterwards (a `claude` ClaudeForge hosts records the same `entrypoint` as any terminal), so ClaudeForge keeps its own list of Session ids, recorded the moment each id appears in one of its terminals.

## Consequences

- The list is the only proof of which conversations are ClaudeForge's, and every day without it is lost for good: it lives in its own file in ClaudeForge's data folder, apart from `state.json`, only ever grows, and an unreadable file is set aside and reported, never replaced by an empty one.
- Sessions created with ClaudeForge before this decision are not recovered: the explorer starts empty.
- A deleted Session keeps its id on the list, so restoring its history from the Recycle Bin brings it back.
- A Session resumed from another terminal is still listed, as an External session.
- A name or hidden mark the user gave a conversation that is no longer listed stays in `state.json`, and applies again if that conversation is ever resumed in ClaudeForge.
