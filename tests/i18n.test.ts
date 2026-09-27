import { describe, expect, it } from 'vitest'
import { translate } from '../src/shared/i18n'

describe('translate', () => {
  it('translates to Spanish and fills placeholders', () => {
    expect(translate('es', 'Next check in {time}', { time: '5 min' })).toBe('Próxima revisión en 5 min')
    expect(translate('en', 'Next check in {time}', { time: '5 min' })).toBe('Next check in 5 min')
  })

  it('falls back to English for unknown text and keeps unknown placeholders', () => {
    expect(translate('es', 'Not in the table {x}')).toBe('Not in the table {x}')
  })
})
