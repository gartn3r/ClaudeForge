import { CircleAlert, CircleArrowUp, RotateCw } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { CLAUDE_CODE_INSTALLATION_GUIDE, type ClaudeCodeStatus } from '../../../shared/api'
import { api } from '../api'

/** Markup the translated sentences may use. */
const RICH_TEXT = {
  code: <code className="cf-mono" />,
  strong: <strong />,
  // Opened in the default browser by the main process.
  guide: <a href={CLAUDE_CODE_INSTALLATION_GUIDE} target="_blank" rel="noreferrer" />
}

type Problem = Exclude<ClaudeCodeStatus, { state: 'found' }>

type TFunction = ReturnType<typeof useTranslation>['t']

/** Everything that differs between the missing and the outdated screen. */
function contentFor(problem: Problem, t: TFunction) {
  switch (problem.state) {
    case 'missing':
      return {
        status: 'error',
        icon: CircleAlert,
        label: t('firstRun.missing.status'),
        title: t('firstRun.missing.title'),
        lead: <Trans i18nKey="firstRun.missing.lead" components={RICH_TEXT} />,
        steps: ['firstRun.missing.install', 'firstRun.missing.checkAgain', 'firstRun.missing.choose'] as const,
        whereLabel: t('firstRun.missing.lookedIn'),
        where: problem.lookedIn.join(' · ')
      }
    case 'outdated':
      return {
        status: 'waiting',
        icon: CircleArrowUp,
        label: t('firstRun.outdated.status'),
        title: t('firstRun.outdated.title', { version: problem.version }),
        lead: t('firstRun.outdated.lead', { minimumVersion: problem.minimumVersion }),
        steps: ['firstRun.outdated.update', 'firstRun.outdated.checkAgain', 'firstRun.outdated.choose'] as const,
        whereLabel: t('firstRun.outdated.foundAt'),
        where: problem.path
      }
  }
}

interface FirstRunProps {
  problem: Problem
  /** Receives every new status the user's actions lead to. */
  onStatus(status: ClaudeCodeStatus): void
}

/** The screen shown instead of the shell while there is no `claude` ClaudeForge can run. */
export function FirstRun({ problem, onStatus }: FirstRunProps): ReactNode {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)

  const act = (call: () => Promise<ClaudeCodeStatus>) => async () => {
    setBusy(true)
    try {
      onStatus(await call())
    } finally {
      setBusy(false)
    }
  }

  const content = contentFor(problem, t)
  const Icon = content.icon

  const checkAgain = (
    <button type="button" className="cf-btn cf-btn--primary" disabled={busy} onClick={act(() => api.claudeCode.locate())}>
      <RotateCw className="cf-icon cf-icon--sm" aria-hidden="true" />
      {t('firstRun.checkAgain')}
    </button>
  )
  const choose = (
    <button type="button" className="cf-btn" disabled={busy} onClick={act(() => api.claudeCode.choose())}>
      {t('firstRun.choose')}
    </button>
  )
  // Each step a tile: install in lime, check again in slate with its button, choose on a card with its own.
  const actions = [null, checkAgain, choose]

  return (
    <main className="first-run" aria-labelledby="first-run-title">
      <div className="first-run__content">
        <div className="first-run__intro">
          <div className="first-run__title">
            <span className={`cf-status cf-status--${content.status} cf-pill`}>
              <Icon className="cf-icon cf-icon--sm" aria-hidden="true" />
              {content.label}
            </span>
            <h1 id="first-run-title">{content.title}</h1>
          </div>
          <p className="cf-muted">{content.lead}</p>
        </div>

        <ol className="first-run__steps">
          {content.steps.map((key, i) => (
            <li key={key} className={i === 1 ? 'cf-on-slate' : undefined}>
              <span className="first-run__step-number" aria-hidden="true">
                {i + 1}
              </span>
              <span>
                <Trans i18nKey={key} components={RICH_TEXT} />
              </span>
              {actions[i]}
            </li>
          ))}
        </ol>

        <div className="first-run__where">
          <span className="cf-eyebrow">{content.whereLabel}</span>
          <code className="cf-mono">{content.where}</code>
        </div>
      </div>
    </main>
  )
}
