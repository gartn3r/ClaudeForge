import { CircleAlert, CircleArrowUp, RotateCw } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import type { ClaudeCodeStatus } from '../../../shared/api'
import { api } from '../api'

const INSTALLATION_GUIDE = 'https://code.claude.com/docs/en/setup'

/** Markup the translated sentences may use. */
const RICH_TEXT = {
  code: <code className="cf-mono" />,
  strong: <strong />,
  // Opened in the default browser by the main process.
  guide: <a href={INSTALLATION_GUIDE} target="_blank" rel="noreferrer" />
}

/** Radii of the contour lines behind the screen, as in the design. */
const CONTOURS = [
  [120, 80],
  [200, 140],
  [290, 205],
  [390, 275],
  [500, 350],
  [620, 430]
] as const

type Problem = Exclude<ClaudeCodeStatus, { state: 'found' }>

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

  const missing = problem.state === 'missing'
  const steps = missing
    ? ['firstRun.missing.install', 'firstRun.missing.checkAgain', 'firstRun.missing.choose']
    : ['firstRun.outdated.update', 'firstRun.outdated.checkAgain', 'firstRun.outdated.choose']

  return (
    <main className="first-run" aria-labelledby="first-run-title">
      <svg className="first-run__contours" viewBox="0 0 1100 664" preserveAspectRatio="none" aria-hidden="true">
        {CONTOURS.map(([rx, ry]) => (
          <ellipse key={rx} cx="900" cy="560" rx={rx} ry={ry} />
        ))}
      </svg>
      <div className="first-run__content">
        <div className="first-run__intro">
          {missing ? (
            <span className="cf-status cf-status--error cf-pill">
              <CircleAlert className="cf-icon cf-icon--sm" aria-hidden="true" />
              {t('firstRun.missing.status')}
            </span>
          ) : (
            <span className="cf-status cf-status--waiting cf-pill">
              <CircleArrowUp className="cf-icon cf-icon--sm" aria-hidden="true" />
              {t('firstRun.outdated.status')}
            </span>
          )}
          <h1 id="first-run-title">
            {missing ? t('firstRun.missing.title') : t('firstRun.outdated.title', { version: problem.version })}
          </h1>
          <p className="cf-muted">
            {missing ? (
              <Trans i18nKey="firstRun.missing.lead" components={RICH_TEXT} />
            ) : (
              t('firstRun.outdated.lead', { minimumVersion: problem.minimumVersion })
            )}
          </p>
        </div>

        <ol className="first-run__steps">
          {steps.map((key, i) => (
            <li key={key}>
              <span className="first-run__step-number" aria-hidden="true">
                {i + 1}
              </span>
              <span>
                <Trans i18nKey={key as 'firstRun.missing.install'} components={RICH_TEXT} />
              </span>
            </li>
          ))}
        </ol>

        <div className="first-run__actions">
          <button
            type="button"
            className="cf-btn cf-btn--primary"
            disabled={busy}
            onClick={act(() => api.claudeCode.locate())}
          >
            <RotateCw className="cf-icon cf-icon--sm" aria-hidden="true" />
            {t('firstRun.checkAgain')}
          </button>
          <button type="button" className="cf-btn" disabled={busy} onClick={act(() => api.claudeCode.choose())}>
            {t('firstRun.choose')}
          </button>
        </div>

        <div className="first-run__where">
          <span className="cf-eyebrow">{missing ? t('firstRun.missing.lookedIn') : t('firstRun.outdated.foundAt')}</span>
          <code className="cf-mono cf-muted">{missing ? problem.lookedIn.join(' · ') : problem.path}</code>
        </div>
      </div>
    </main>
  )
}
