import type { BackendApi } from '../../shared/api'
import type { Environment } from '../claude-code'
import { createGh, GhError } from './gh'
import { createGitHubTracker } from './github'
import { listMaps, readMap } from './local-markdown'
import { deriveMap } from './model'
import { detectTracker } from './tracker'

/** The Map service: reads a Project's Maps from its Tracker, never writing to it (ADR 0002). */
export function createMapService(env: Environment): BackendApi['map'] {
  const github = createGitHubTracker(createGh(env))
  return {
    async list(project) {
      const tracker = await detectTracker(project)
      if (tracker.kind === 'local-markdown') return { tracker, maps: await listMaps(project) }
      if (tracker.kind === 'unsupported') return { tracker, maps: [] }
      try {
        return { tracker, maps: await github.listMaps(project) }
      } catch (error) {
        if (error instanceof GhError) return { tracker, problem: error.problem, maps: [] }
        throw error
      }
    },
    async load(project, mapId) {
      const tracker = await detectTracker(project)
      if (tracker.kind === 'local-markdown') return deriveMap(await readMap(project, mapId))
      if (tracker.kind === 'github') return deriveMap(await github.readMap(project, mapId))
      throw new Error(`The Tracker of ${project} is not supported`)
    }
  }
}
