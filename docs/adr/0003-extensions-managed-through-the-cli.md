# Manage Extensions through the Claude Code CLI first

ClaudeForge changes MCP servers and plugins through `claude mcp …` and `claude plugin …` whenever a command exists, and writes Claude Code's files directly only for what the CLI does not cover (skills and subagents). Claude Code's config file formats are internal and change between releases; the CLI is the stable surface, so this keeps ClaudeForge working across Claude Code updates at the cost of shelling out and parsing command output.
