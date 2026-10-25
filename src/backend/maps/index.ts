import type { BackendApi, MapSummary } from '../../shared/api'
import type { Environment } from '../claude-code'
import { createGh, GhError } from './gh'
import { createGitHubTracker } from './github'
import { listMaps, readMap } from './local-markdown'
import { deriveMap, type MapRecord } from './model'
import { detectTracker } from './tracker'

/** What reads the Maps of one kind of Tracker. */
interface TrackerAdapter {
  listMaps(project: string): Promise<MapSummary[]>
  readMap(project: string, mapId: string): Promise<MapRecord>
}

/** The Map service: reads a Project's Maps from its Tracker, never writing to it (ADR 0002). */
export function createMapService(env: Environment): BackendApi['map'] {
  const adapters: Record<'local-markdown' | 'github', TrackerAdapter> = {
    'local-markdown': { listMaps, readMap },
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
    }
  }
}
