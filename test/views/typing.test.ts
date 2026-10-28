import { describe, expect, it } from 'vitest'
import { planTyping } from '../../src/renderer/src/terminal/typing'

const recipeBox = 'C:\\projects\\recipe-box'
const harborApi = 'C:\\projects\\harbor-api'

describe('typing a command, never sending it, by the Skill shortcut rule', () => {
  it('types into the Hosted session on show when it is ready, else says it is busy', () => {
    for (const status of ['idle', 'done'] as const) {
      expect(planTyping({ key: 'a', project: recipeBox, status }, null, recipeBox)).toEqual({ kind: 'type', key: 'a' })
    }
    for (const status of ['working', 'waiting'] as const) {
      expect(planTyping({ key: 'a', project: recipeBox, status }, null, recipeBox)).toEqual({ kind: 'busy', key: 'a' })
    }
  })

  it('starts a new Session of the displayed Project when no Hosted session is on show', () => {
    expect(planTyping(null, null, recipeBox)).toEqual({ kind: 'start', project: recipeBox })
  })

  it("types an action only into its own Project's Session, else into a new Session of its Project", () => {
    const shown = { key: 'a', project: harborApi, status: 'idle' } as const
    expect(planTyping(shown, recipeBox, harborApi)).toEqual({ kind: 'start', project: recipeBox })
    expect(planTyping(null, recipeBox, harborApi)).toEqual({ kind: 'start', project: recipeBox })
    // Windows paths match whatever their case and slashes.
    expect(planTyping(shown, 'c:/projects/HARBOR-API/', recipeBox)).toEqual({ kind: 'type', key: 'a' })
  })
})
