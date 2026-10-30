# ClaudeForge reads the Azure DevOps backlog itself, through the `az` CLI

The Work items card lists the Current sprint's Work items that are unassigned or assigned to the user. ClaudeForge fetches them itself: its main process runs `az boards query` (and `az boards iteration project list` to find the Current sprint) with the user's own `az login`, and shows the result in a card of its own. Until now ClaudeForge spoke only to `claude` and to GitHub; this adds Azure DevOps, through the CLI the user already has and is already signed in to, so ClaudeForge holds no token of its own. One configuration (organisation, project, area path, iteration root) serves every Project.

## Considered Options

- **Claude fetches them, through a skill in a Hosted session, and fills a Created card with the ClaudeForge CLI**: needs no new code in ClaudeForge, but costs tokens on every refresh, needs a running Session, and the card would belong to one Project only. Rejected for a card that should be there whenever ClaudeForge is open.
- **The Azure DevOps REST API with a personal access token**: no dependency on `az`, but ClaudeForge would have to store a secret, and the user would manage a second sign-in beside the one `az` already has.
- **Azure DevOps teams and `@CurrentIteration`**: one setting instead of an area path and an iteration root, but it ties the card to how the team is set up in Azure; the area and the sprints the user works in live in two different trees.

## Consequences

- The card works only where `az` and its `azure-devops` extension are installed and the user is signed in; otherwise it says which command to run.
- On Windows, `az` printed accented titles garbled in a first test, even with `PYTHONIOENCODING=utf-8`; ClaudeForge must find how to read its output intact (`-o json` written to a file, or the code page `az` uses) before showing titles.
- The card refreshes only when a Project is displayed and when the user asks, so ClaudeForge never queries Azure DevOps in the background.
