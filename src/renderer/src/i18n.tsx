import { createContext, Fragment, useContext, type ReactNode } from 'react'
import { LOCALES, translate, type Lang } from '@shared/i18n'

export const LangContext = createContext<Lang>('en')

export type T = (text: string, vars?: Record<string, string | number>) => string

export function useT() {
  const lang = useContext(LangContext)
  const t: T = (text, vars) => translate(lang, text, vars)
  /** Like t(), but placeholders can be React nodes, e.g. tn('Drops below {price}', { price: <b>$5</b> }). */
  const tn = (text: string, nodes: Record<string, ReactNode>): ReactNode =>
    translate(lang, text)
      .split(/\{(\w+)\}/)
      .map((part, i) => <Fragment key={i}>{i % 2 ? (nodes[part] ?? `{${part}}`) : part}</Fragment>)
  return { t, tn, lang, locale: LOCALES[lang] }
}
