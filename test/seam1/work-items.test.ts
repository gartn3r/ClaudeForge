import { describe, expect, it } from 'vitest'
import type { BacklogConfig, Sprint, WorkItem, WorkItemAction } from '../../src/shared/api'
import {
  actionCommand,
  actionColour,
  actionProblems,
  classificationPath,
  contrastRatio,
  currentSprint,
  itemPath,
  localDate,
  organizationUrl,
  parseWorkItems,
  pathsIn,
  sprintsIn,
  textOn,
  tidyWorkItemActions,
  workItemKind,
  workItemStarted,
  workItemUrl,
  workItemsQuery
} from '../../src/shared/work-items'

const config: BacklogConfig = {
  organization: 'https://devops.example.test/acme',
  project: 'Acme',
  areaPath: 'Acme\\Storefront',
  iterationRoot: 'Acme\\Retail\\Team Storefront'
}

const sprint = (name: string, start: string, finish: string): Sprint => ({
  name,
  path: `${config.iterationRoot}\\2026\\${name}`,
  start,
  finish
})

/** Q4 2026 as the live backlog has it: three weeks each, Monday to Friday. */
const sprints = [
  sprint('Q4 Sprint 01', '2026-10-05', '2026-10-23'),
  sprint('Q4 Sprint 02', '2026-10-26', '2026-11-13'),
  sprint('Q4 Sprint 03', '2026-11-16', '2026-12-04')
]

const workItem: WorkItem = {
  id: 1101,
  type: 'Product Backlog Item',
  state: 'To Do',
  title: 'Catalogue - Amélioration de l’indexation',
  assignedToMe: false
}

const action = (fields: Partial<WorkItemAction> = {}): WorkItemAction => ({
  id: 'a1',
  label: 'Analyse',
  skill: 'analyze-ticket',
  text: 'analyse #{id}',
  colour: 'outline',
  ...fields
})

describe('the Current sprint', () => {
  it('is the sprint whose dates contain today, first and last days included', () => {
    expect(currentSprint(sprints, '2026-10-30')).toEqual({ sprint: sprints[1], upcoming: false })
    expect(currentSprint(sprints, '2026-10-26')).toEqual({ sprint: sprints[1], upcoming: false })
    expect(currentSprint(sprints, '2026-11-13')).toEqual({ sprint: sprints[1], upcoming: false })
  })

  it('is, between two sprints, the next one to start, flagged as upcoming', () => {
    expect(currentSprint(sprints, '2026-11-14')).toEqual({ sprint: sprints[2], upcoming: true })
    expect(currentSprint([sprints[2]!, sprints[0]!], '2026-10-25')).toEqual({ sprint: sprints[2], upcoming: true })
  })

  it('is none when no sprint is running or to come', () => {
    expect(currentSprint(sprints, '2026-12-05')).toBeNull()
    expect(currentSprint([], '2026-10-30')).toBeNull()
  })

  it('is read from a date as the user lives it, not in UTC', () => {
    expect(localDate(new Date(2026, 9, 30, 23, 59))).toBe('2026-10-30')
    expect(localDate(new Date(2026, 0, 2, 0, 1))).toBe('2026-01-02')
  })
})

describe('classification nodes', () => {
  it('names an iteration or area under its own tree, as `az` lists it', () => {
    expect(classificationPath(config.iterationRoot, 'Iteration')).toBe(
      '\\Acme\\Iteration\\Retail\\Team Storefront'
    )
    expect(classificationPath('Acme', 'Area')).toBe('\\Acme\\Area')
  })

  it('gives back the path a Work item names its iteration or area with', () => {
    expect(itemPath('\\Acme\\Iteration\\Retail\\Team Storefront\\2026\\Q4 Sprint 02')).toBe(
      'Acme\\Retail\\Team Storefront\\2026\\Q4 Sprint 02'
    )
    expect(itemPath('\\Acme\\Area')).toBe('Acme')
  })

  const tree = {
    name: 'Team Storefront',
    path: '\\Acme\\Iteration\\Retail\\Team Storefront',
    attributes: null,
    children: [
      {
        name: '2026',
        path: '\\Acme\\Iteration\\Retail\\Team Storefront\\2026',
        attributes: null,
        children: [
          {
            name: 'Q4 Sprint 02',
            path: '\\Acme\\Iteration\\Retail\\Team Storefront\\2026\\Q4 Sprint 02',
            attributes: { startDate: '2026-10-26T00:00:00Z', finishDate: '2026-11-13T00:00:00Z' },
            children: null
          },
          // A sprint without dates yet is no sprint.
          {
            name: 'Q1 Sprint 01',
            path: '\\Acme\\Iteration\\Retail\\Team Storefront\\2026\\Q1 Sprint 01',
            attributes: null
          }
        ]
      }
    ]
  }

  it('finds the sprints at any depth under the iteration root, with their dates', () => {
    expect(sprintsIn(tree)).toEqual([sprint('Q4 Sprint 02', '2026-10-26', '2026-11-13')])
    expect(sprintsIn({ garbage: true })).toEqual([])
  })

  it('lists every node for areas, and only those holding sprints for iteration roots', () => {
    expect(pathsIn(tree, 'all')).toEqual([
      'Acme\\Retail\\Team Storefront',
      'Acme\\Retail\\Team Storefront\\2026',
      'Acme\\Retail\\Team Storefront\\2026\\Q4 Sprint 02',
      'Acme\\Retail\\Team Storefront\\2026\\Q1 Sprint 01'
    ])
    expect(pathsIn(tree, 'folders')).toEqual([
      'Acme\\Retail\\Team Storefront',
      'Acme\\Retail\\Team Storefront\\2026'
    ])
  })
})

describe('the Work items query', () => {
  it('asks for the open Work items of the area in the sprint, unassigned or the user’s, in backlog order', () => {
    expect(workItemsQuery(config, sprints[1]!.path)).toBe(
      'SELECT [System.Id],[System.WorkItemType],[System.State],[System.AssignedTo],[System.Title] FROM WorkItems' +
        " WHERE [System.AreaPath] UNDER 'Acme\\Storefront'" +
        " AND [System.IterationPath] = 'Acme\\Retail\\Team Storefront\\2026\\Q4 Sprint 02'" +
        " AND ([System.AssignedTo] = @Me OR [System.AssignedTo] = '')" +
        " AND [System.State] NOT IN ('Done','Removed','Closed')" +
        ' ORDER BY [Microsoft.VSTS.Common.StackRank]'
    )
  })

  it('doubles the single quotes of a path', () => {
    expect(workItemsQuery({ ...config, areaPath: "Acme\\Retail's" }, "Acme\\Q'4")).toContain(
      "UNDER 'Acme\\Retail''s' AND [System.IterationPath] = 'Acme\\Q''4'"
    )
  })
})

describe('Work items read from az', () => {
  it('keeps the id, type, state, title and whether the user has it, in the order given', () => {
    const json = [
      {
        id: 1102,
        fields: {
          'System.Id': 1102,
          'System.State': 'In Progress',
          'System.Title': 'Sauvegarde des exports',
          'System.WorkItemType': 'Product Backlog Item',
          'System.AssignedTo': { displayName: 'Fixture User', uniqueName: 'fixture.user@example.com' }
        }
      },
      { id: 1101, fields: { 'System.State': 'To Do', 'System.Title': workItem.title, 'System.WorkItemType': workItem.type } },
      { id: 'broken', fields: {} },
      { id: 5 }
    ]
    expect(parseWorkItems(json)).toEqual([
      { id: 1102, type: 'Product Backlog Item', state: 'In Progress', title: 'Sauvegarde des exports', assignedToMe: true },
      workItem
    ])
    expect(parseWorkItems({ not: 'a list' })).toEqual([])
  })

  it('shows each type with its glyph, and the bugs of every kind as a Bug', () => {
    expect(workItemKind('Product Backlog Item')).toEqual({ glyph: 'pbi', label: null })
    expect(workItemKind('Bug')).toEqual({ glyph: 'bug', label: 'Bug' })
    expect(workItemKind('BugInnovation')).toEqual({ glyph: 'bug', label: 'Bug' })
    expect(workItemKind('Task')).toEqual({ glyph: 'task', label: null })
    expect(workItemKind('Feature')).toEqual({ glyph: 'feature', label: null })
    expect(workItemKind('Epic')).toEqual({ glyph: 'other', label: 'Epic' })
  })

  it('tells a state not started yet from one in progress', () => {
    expect(workItemStarted('To Do')).toBe(false)
    expect(workItemStarted('To Refine')).toBe(false)
    expect(workItemStarted('In Progress')).toBe(true)
    expect(workItemStarted('In Code Review')).toBe(true)
  })

  it('opens a Work item at its address in the organisation', () => {
    expect(workItemUrl(config, 1101)).toBe('https://devops.example.test/acme/Acme/_workitems/edit/1101')
    expect(workItemUrl({ ...config, organization: 'https://devops.example.test/acme/', project: 'My Project' }, 1)).toBe(
      'https://devops.example.test/acme/My%20Project/_workitems/edit/1'
    )
  })

  it('keeps an organisation by its address, trimmed, never assuming a host', () => {
    expect(organizationUrl(' https://devops.example.test/acme/ ')).toBe('https://devops.example.test/acme')
    expect(organizationUrl('acme')).toBe('acme')
    expect(organizationUrl('')).toBe('')
  })
})

describe('Work item actions', () => {
  const url = workItemUrl(config, workItem.id)

  it('type their skill and their text, the placeholders filled', () => {
    expect(actionCommand(action({ text: 'analyse #{id} ({type}) {title} {url}' }), workItem, url)).toBe(
      `/analyze-ticket analyse #1101 (Product Backlog Item) Catalogue - Amélioration de l’indexation ${url}`
    )
    expect(actionCommand(action({ text: '' }), workItem, url)).toBe('/analyze-ticket')
  })

  it('write the address decoded, so a project name with a space survives the percent signs going', () => {
    const spaced = workItemUrl({ ...config, project: 'My Project' }, 12)
    expect(actionCommand(action({ text: '{url}' }), workItem, spaced)).toBe(
      '/analyze-ticket https://devops.example.test/acme/My Project/_workitems/edit/12'
    )
  })

  it('fill each placeholder once, so a title naming one stays as it is', () => {
    expect(actionCommand(action({ text: '{title}' }), { ...workItem, title: 'Show {id}' }, url)).toBe('/analyze-ticket Show {id}')
  })

  it('make a title typeable: double quotes become single ones, percent signs go, line breaks become spaces', () => {
    const title = 'Say "hi" to 50% of\r\nusers\nnow'
    expect(actionCommand(action({ text: '{title}' }), { ...workItem, title }, url)).toBe("/analyze-ticket Say 'hi' to 50 of users now")
  })

  it('refuse a missing label or skill, and a text that could not be typed', () => {
    expect(actionProblems(action())).toEqual([])
    expect(actionProblems(action({ label: ' ', skill: '' }))).toEqual(['label-missing', 'skill-missing'])
    expect(actionProblems(action({ skill: '/review' }))).toEqual(['skill-missing'])
    expect(actionProblems(action({ text: 'say "hi"' }))).toEqual(['text-forbidden'])
  })

  it('are kept trimmed, three at most, those refused or blank left out', () => {
    const kept = tidyWorkItemActions([
      action({ id: 'a', label: ' Analyse ', text: ' analyse #{id} ' }),
      action({ id: 'b', label: '', skill: '', text: '' }),
      action({ id: 'c', skill: '' }),
      action({ id: 'd', colour: '#8FB3D9' }),
      action({ id: 'a', label: 'Same id' }),
      action({ id: 'e', colour: 'not a colour' }),
      action({ id: 'f' })
    ])
    expect(kept).toEqual([
      action({ id: 'a' }),
      action({ id: 'd', colour: '#8fb3d9' }),
      action({ id: 'e', colour: 'outline' })
    ])
  })

  it('show the first in lime, and the others in their own colour, never lime', () => {
    expect(actionColour(action({ colour: '#8fb3d9' }), 0)).toBe('#b0c92e')
    expect(actionColour(action({ colour: '#8fb3d9' }), 1)).toBe('#8fb3d9')
    expect(actionColour(action({ colour: '#B0C92E' }), 2)).toBe('outline')
    expect(actionColour(action(), 1)).toBe('outline')
  })

  it('write their label light or dark, whichever reads at 4.5:1 or better', () => {
    for (const background of ['#b0c92e', '#8fb3d9', '#8ccbc4', '#e3c76a', '#e58a7a', '#c9a3d9', '#2f353f', '#000000', '#ffffff', '#3a7bd5']) {
      const text = textOn(background)
      expect([text, background, contrastRatio(text, background) >= 4.5]).toEqual([text, background, true])
    }
    expect(textOn('#b0c92e')).toBe('#2f353f')
    expect(textOn('#2f353f')).toBe('#f5f1e3')
  })
})
