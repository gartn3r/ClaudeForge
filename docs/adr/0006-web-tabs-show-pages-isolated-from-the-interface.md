# Web tabs show pages inside ClaudeForge, isolated from its interface

Until now the interface never navigated and every link opened in the default browser. Web shortcuts change that: their page opens in a Web tab beside the Hosted sessions, so the user keeps it in view next to Claude Code instead of switching windows. Any `http`, `https` or `file` address is accepted, `localhost` included, so a Project's dev server or a local report can sit next to the Session working on it.

A page shown there is untrusted content inside a desktop app that can drive terminals, so it lives apart from the interface: its own persistent storage (sign-ins survive a restart, but a page can read nothing of ClaudeForge's), no access to the bridge the interface uses, and every new window it asks for opened in the default browser instead, except a sign-in popup.

A sign-in popup (a page's `window.open` with window features, to an http or https address, as "Continue with Google" does) opens in a ClaudeForge window instead, a child of the interface's: it must stay the page's popup to post its token back through `window.opener`, and share the Web tab's storage for the sign-in to land there. That window is isolated like a Web tab's page: the same storage, sandboxed, context-isolated, no preload or bridge, no Node, no `<webview>`; its own new windows and navigations follow the same rules. A `target=_blank` link, a background tab or any other new window still goes to the default browser, and only when it is http or https.

Google refuses to sign in from what it takes for an embedded browser, so ClaudeForge sends a browser's user agent, without Electron's and its own tokens. Electron gives a popup window its fallback user agent whatever its storage's says, so it is that fallback, the whole app's, that drops them.

## Considered Options

- Opening Web shortcuts in the default browser, as every other link does: safe and simple, but the page leaves ClaudeForge, which is what the user wanted to avoid.
- Sending sign-in popups to the default browser too, as at first: the popup loses `window.opener` and the Web tab's storage, so the sign-in never completes (Google's stays blank, and the Web tab says it failed).
- A full browser in the tab, with an editable address: rejected; a Web tab shows the page its Shortcut names and follows its links, nothing more.

## Consequences

- Sites that sign in through a popup are signed into inside the Web tab: the popup shows in a ClaudeForge window and closes itself once done. A page can open such a window at will, as a browser would let it; it gets nothing more than the Web tab's page has.
- Every request ClaudeForge makes through Electron, not only a Web tab's, carries the browser's user agent.
- Accepting `file` addresses lets a Web shortcut show any local file the user's account can read; the address is always one the user typed.
