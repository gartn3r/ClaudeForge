import { useEffect, useState } from 'react'
import type { ElementView } from '../../../shared/elements'
import { api, onEvent } from '../api'
import { samePath } from '../terminal/typing'

/**
 * ClaudeForge's own Elements and the displayed Project's Created Elements, as the contract lists
 * them; listed again whenever the backend says ClaudeForge's own or that Project's changed. Null
 * until they are first listed; only ClaudeForge's own while another Project's are still listed.
 */
export function useElements(project: string): ElementView[] | null {
  const [listed, setListed] = useState<{ project: string; elements: ElementView[] } | null>(null)
  const [revision, setRevision] = useState(0)

  useEffect(
    () =>
      onEvent('elements.changed', (change) => {
        if (change.project === null || samePath(change.project, project)) setRevision((current) => current + 1)
      }),
    [project]
  )

  useEffect(() => {
    let current = true
    void api.elements
      .request({ op: 'list', project })
      .then((result) => current && result.ok && setListed({ project, elements: result.elements }))
      .catch(() => undefined)
    return () => {
      current = false
    }
  }, [project, revision])

  if (!listed) return null
  // While another Project's are listed, ClaudeForge's own stay as they were, so nothing jumps.
  return listed.project === project ? listed.elements : listed.elements.filter((element) => element.project === null)
}
