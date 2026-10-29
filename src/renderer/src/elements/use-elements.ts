import { useEffect, useState } from 'react'
import type { ElementView } from '../../../shared/elements'
import { api, onEvent } from '../api'
import { samePath } from '../terminal/typing'

/** The Elements as the contract last listed them, and the Project they were listed for. */
export interface ElementListing {
  project: string
  elements: ElementView[]
}

/**
 * ClaudeForge's own Elements and the Project's Created Elements, as the contract lists them, listed
 * again whenever the backend says ClaudeForge's own or that Project's changed. Null until first
 * listed; while another Project's are listed, the last listing stays, for the Project it was.
 */
export function useElements(project: string): ElementListing | null {
  const [listed, setListed] = useState<ElementListing | null>(null)
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
  return listed
}
