# Web tabs show pages inside ClaudeForge, isolated from its interface

Until now the interface never navigated and every link opened in the default browser. Web shortcuts change that: their page opens in a Web tab beside the Hosted sessions, so the user keeps it in view next to Claude Code instead of switching windows. Any `http`, `https` or `file` address is accepted, `localhost` included, so a Project's dev server or a local report can sit next to the Session working on it.

A page shown there is untrusted content inside a desktop app that can drive terminals, so it lives apart from the interface: its own persistent storage (sign-ins survive a restart, but a page can read nothing of ClaudeForge's), no access to the bridge the interface uses, and every new window it asks for, sign-in popups included, opened in the default browser instead.

## Considered Options

- Opening Web shortcuts in the default browser, as every other link does: safe and simple, but the page leaves ClaudeForge, which is what the user wanted to avoid.
- A full browser in the tab, with an editable address: rejected; a Web tab shows the page its Shortcut names and follows its links, nothing more.

## Consequences

- Sites that sign in through a popup cannot be signed into inside a Web tab; they still work from "Open in browser".
- Accepting `file` addresses lets a Web shortcut show any local file the user's account can read; the address is always one the user typed.
