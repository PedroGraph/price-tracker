import { describe, expect, it } from 'vitest'
import { toCsv } from '../src/shared/csv'

describe('toCsv', () => {
  it('quotes, escapes and neutralises formulas', () => {
    const csv = toCsv(
      [
        { a: 'Tapo, cámara "solar"', b: 59.99, c: null },
        { a: '=HYPERLINK("x")', b: -1, c: true }
      ],
      ['a', 'b', 'c']
    )
    expect(csv.split('\r\n')).toEqual(['a,b,c', '"Tapo, cámara ""solar""",59.99,', `"'=HYPERLINK(""x"")",-1,true`, ''])
  })
})
