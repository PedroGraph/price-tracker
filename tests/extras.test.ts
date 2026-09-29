import { describe, expect, it } from 'vitest'
import { parseCount, parseHistogram, parseRating, parseSalesRank, parseStockLeft } from '../src/shared/extras'

describe('product page extras', () => {
  it('reads how many are left', () => {
    expect(parseStockLeft('Only 3 left in stock - order soon.')).toBe(3)
    expect(parseStockLeft('Solo quedan 12 en stock (hay más unidades en camino).')).toBe(12)
    expect(parseStockLeft('In Stock')).toBeNull()
  })

  it('reads the top sales rank in English and Spanish', () => {
    expect(parseSalesRank('Best Sellers Rank: #1,234 in Electronics (See Top 100 in Electronics) #5 in Earbuds')).toEqual({
      rank: 1234,
      category: 'Electronics'
    })
    expect(parseSalesRank('Clasificación en los más vendidos de Amazon nº5 en Videograbadoras para Vigilancia')).toEqual({
      rank: 5,
      category: 'Videograbadoras para Vigilancia'
    })
    expect(parseSalesRank(null)).toBeNull()
  })

  it('reads the rating, the count and the histogram', () => {
    expect(parseRating('4,7 de 5 estrellas')).toBe(4.7)
    expect(parseCount('(28,765)')).toBe(28765)
    expect(
      parseHistogram([
        'El 87 por ciento de las opiniones tienen 5 estrellas',
        'El 8 por ciento de las opiniones tienen 4 estrellas',
        '3 percent of reviews have 1 stars'
      ])
    ).toEqual([87, 8, 0, 0, 3])
  })
})
