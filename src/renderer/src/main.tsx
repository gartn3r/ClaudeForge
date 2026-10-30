// Fonts ship inside the app as files (SIL OFL); nothing is fetched at runtime.
import '@fontsource/fraunces/latin-500.css'
import '@fontsource/fraunces/latin-600.css'
import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-500.css'
import '@fontsource/inter/latin-600.css'
import '@fontsource/inter/latin-700.css'
import '@fontsource/jetbrains-mono/latin-400.css'
import '@fontsource/jetbrains-mono/latin-600.css'
import '@xterm/xterm/css/xterm.css'
import './styles/tokens.css'
import './styles/components.css'
import './styles/shell.css'
import './styles/first-run.css'
import './styles/shortcuts.css'
import './styles/work-items.css'
import './styles/elements.css'
import './styles/right-panel.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { api } from './api'
import { initI18n } from './i18n'

async function start(): Promise<void> {
  const [info, state, claudeCode] = await Promise.all([
    api.system.info(),
    api.appState.read(),
    api.claudeCode.locate()
  ])
  await initI18n(info.language)
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App initialState={state} initialClaudeCode={claudeCode} project={info.startFolder} />
    </StrictMode>
  )
}

void start()
