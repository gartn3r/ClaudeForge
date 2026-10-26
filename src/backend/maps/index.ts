import type { BackendApi, MapSummary } from '../../shared/api'
import type { WayfinderReference } from '../../shared/wayfinder-reference'
import type { Environment } from '../claude-code'
import { createGh, GhError } from './gh'
import { createGitHubTracker } from './github'
import { listMaps, mapHolding, readMap } from './local-markdown'
import { deriveMap, type MapRecord } from './model'
import { detectTracker } from './tracker'

/** What reads the Maps of one kind of Tracker. */
interface TrackerAdapter {
  listMaps(project: string): Promise<MapSummary[]>
  readMap(project: string, mapId: string): Promise<MapRecord>
  /** The id of the Map holding the Ticket a reference names; null when there is none. */
  mapHolding(project: string, reference: WayfinderReference): Promise<string | null>
}

/** What reads a Project's Maps; opening an issue is the desktop's. */
export type MapReader = Pick<BackendApi['map'], 'list' | 'load'> & {
  /** The id of the Map holding the Ticket a reference names, to work that Ticket as a Map; null when none does. */
  mapHolding(project: string, reference: WayfinderReference): Promise<string | null>
}

/** The Map service: reads a Project's Maps from its Tracker, never writing to it (ADR 0002). */
export function createMapService(env: Environment): MapReader {
  const adapters: Record<'local-markdown' | 'github', TrackerAdapter> = {
    'local-markdown': { listMaps, readMap, mapHolding },
    github: createGitHubTracker(createGh(env))
  }
  return {
    async list(project) {
      const tracker = await detectTracker(project)
      if (tracker.kind === 'unsupported') return { tracker, maps: [] }
      try {
        return { tracker, maps: await adapters[tracker.kind].listMaps(project) }
      } catch (error) {
        if (error instanceof GhError) return { tracker, problem: error.problem, maps: [] }
        throw error
      }
    },
    async load(project, mapId) {
      const tracker = await detectTracker(project)
      if (tracker.kind === 'unsupported') throw new Error(`The Tracker of ${project} is not supported`)
      return deriveMap(await adapters[tracker.kind].readMap(project, mapId))
    },
    async mapHolding(project, reference) {
      const tracker = await detectTracker(project)
      if (tracker.kind === 'unsupported') return null
      try {
        return await adapters[tracker.kind].mapHolding(project, reference)
      } catch (error) {
        // A Tracker that cannot be read now holds no Map, as `list` then lists none.
        if (error instanceof GhError) return null
        throw error
      }
    }
  }
}
