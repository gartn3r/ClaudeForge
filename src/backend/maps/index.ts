import type { BackendApi } from '../../shared/api'
import { listMaps, readMap } from './local-markdown'
import { deriveMap } from './model'
import { detectTracker } from './tracker'

/** The Map service: reads a Project's Maps from its Tracker, never writing to it (ADR 0002). */
export function createMapService(): BackendApi['map'] {
  return {
    async list(project) {
      const tracker = await detectTracker(project)
      return { tracker, maps: tracker.kind === 'local-markdown' ? await listMaps(project) : [] }
    },
    async load(project, mapId) {
      const tracker = await detectTracker(project)
      if (tracker.kind !== 'local-markdown') throw new Error(`The Tracker of ${project} is not supported`)
      return deriveMap(await readMap(project, mapId))
    }
  }
}
