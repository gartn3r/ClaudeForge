import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import type { Language } from '../../shared/api'
import en from './locales/en.json'
import fr from './locales/fr.json'

export const resources = { en: { translation: en }, fr: { translation: fr } } as const

export async function initI18n(language: Language): Promise<void> {
  document.documentElement.lang = language
  await i18next.use(initReactI18next).init({
    resources,
    lng: language,
    fallbackLng: 'en',
    interpolation: { escapeValue: false }
  })
}

declare module 'i18next' {
  interface CustomTypeOptions {
    resources: (typeof resources)['en']
  }
}
