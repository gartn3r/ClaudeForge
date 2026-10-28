// Renders an interface piece to markup in Node, in the language asked, as the window would show it
// once it is mounted; no window shows these pieces yet.

import i18next, { type i18n } from 'i18next'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import type { Language } from '../../src/shared/api'
import { resources } from '../../src/renderer/src/i18n'

const instances = new Map<Language, Promise<i18n>>()

function instance(language: Language): Promise<i18n> {
  let created = instances.get(language)
  if (!created) {
    const next = i18next.createInstance()
    created = next
      .use(initReactI18next)
      .init({ resources, lng: language, fallbackLng: 'en', interpolation: { escapeValue: false } })
      .then(() => next)
    instances.set(language, created)
  }
  return created
}

export async function render(node: ReactNode, language: Language = 'en'): Promise<string> {
  return renderToStaticMarkup(<I18nextProvider i18n={await instance(language)}>{node}</I18nextProvider>)
}
