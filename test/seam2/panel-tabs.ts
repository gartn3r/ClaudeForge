import { expect, type Locator, type Page } from '@playwright/test'

/** The Right panel's Panel tabs, as its header lists them. */
export const panelTabs = (window: Page, name = 'Panel tabs'): Locator => window.getByRole('tablist', { name }).getByRole('tab')

/** Creates a Panel tab with the Right panel's **+**, as the user would. */
export async function createPanelTab(window: Page, title: string, name: string): Promise<void> {
  await window.getByRole('button', { name: 'New Panel tab' }).click()
  const dialog = window.getByRole('dialog', { name: 'New Panel tab' })
  await dialog.getByLabel('Title').fill(title)
  await dialog.getByLabel('Identifier').fill(name)
  await dialog.getByRole('button', { name: 'Create' }).click()
  await expect(dialog).toBeHidden()
}

/** The fields of each kind of Content item, by the labels the form shows them under. */
export type ContentFields = Partial<Record<'Text' | 'Title' | 'Address' | 'File' | 'Command', string>>

/** Adds a Content item to a Panel tab by hand: right-click on the tab, Add content. */
export async function addContent(
  window: Page,
  tab: string,
  kind: 'Text' | 'Link' | 'File' | 'Web page' | 'Action',
  fields: ContentFields
): Promise<void> {
  await panelTabs(window).filter({ hasText: tab }).click({ button: 'right' })
  await window.getByRole('menu', { name: `${tab} actions` }).getByRole('menuitem', { name: 'Add content' }).click()
  const dialog = window.getByRole('dialog', { name: `Add content to ${tab}` })
  await dialog.getByRole('button', { name: kind, exact: true }).click()
  for (const [label, value] of Object.entries(fields)) await dialog.getByLabel(label, { exact: true }).fill(value)
  await dialog.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(dialog).toBeHidden()
}

/** The items of a right-click menu, in order. */
export const menuItems = (window: Page, name: string): Locator => window.getByRole('menu', { name }).getByRole('menuitem')
