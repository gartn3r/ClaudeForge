import { useEffect, useState } from 'react'
import type { ElementView } from '../../../shared/elements'
import { api, onEvent } from '../api'
import { samePath } from '../terminal/typing'

/**
 * ClaudeForge's own Elements and the Project's Created Elements, as the contract lists them, listed
 * again whenever the backend says they changed; null until the Project's are read.
 */
export function useElements(project: string): ElementView[] | null {
  const [listed, setListed] = useState<{ project: string; elements: ElementView[] } | null>(null)
  const [revision, setRevision] = useState(0)
  useEffect(
    () =>
      onEvent('elements.changed', (change) => {
        if (change.project === null || samePath(change.project, project)) setRevision((each) => each + 1)
      }),
    [project]
  )
  useEffect(() => {
    let current = true
    api.elements.request({ op: 'list', project }).then(
      (result) => current && result.ok && setListed({ project, elements: result.elements }),
      () => undefined
    )
    return () => {
      current = false
    }
  }, [project, revision])
  return listed?.project === project ? listed.elements : null
}
