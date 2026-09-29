/** Turns the product page's extra texts (stock, rank, reviews) into numbers. English and Spanish. */

/** "Only 3 left in stock" / "Solo quedan 3 en stock" → 3. */
export function parseStockLeft(text: string | null): number | null {
  if (!text) return null
  const m = /(?:only|solo|s[oó]lo)\s+(?:quedan?\s+)?(\d{1,4})\b/i.exec(text) ?? /\b(\d{1,4})\s+(?:left|disponibles?)\b/i.exec(text)
  return m ? Number(m[1]) : null
}

/**
 * The top-level (first) rank of a "Best Sellers Rank" line:
 * "#1,234 in Electronics (See Top 100…) #5 in Earbuds" → { rank: 1234, category: 'Electronics' }.
 */
export function parseSalesRank(text: string | null): { rank: number; category: string } | null {
  if (!text) return null
  const m = /(?:#|n[º°o.]\s*)\s*([\d.,]+)\s+(?:in|en)\s+([^(#\n]+?)(?=\s*\(|\s*#|\s*n[º°o.]\s*\d|$)/i.exec(text)
  if (!m) return null
  const rank = Number(m[1].replace(/[.,]/g, ''))
  return Number.isFinite(rank) && rank > 0 ? { rank, category: m[2].trim() } : null
}

/** "4.7 out of 5 stars" / "4,7 de 5 estrellas" → 4.7. */
export function parseRating(text: string | null): number | null {
  const m = text ? /(\d(?:[.,]\d)?)/.exec(text) : null
  return m ? Number(m[1].replace(',', '.')) : null
}

/** "(28,765)" / "28.765 calificaciones" → 28765. */
export function parseCount(text: string | null): number | null {
  const m = text ? /(\d[\d.,]*)/.exec(text) : null
  return m ? Number(m[1].replace(/[.,]/g, '')) : null
}

/** Histogram labels ("87 percent of reviews have 5 stars") → percentages for 5, 4, 3, 2 and 1 stars. */
export function parseHistogram(labels: string[]): number[] {
  const out = [0, 0, 0, 0, 0]
  for (const label of labels) {
    const pct = /(\d{1,3})\s*(?:%|percent|por\s*ciento)/i.exec(label.replace(/ /g, ' '))
    const stars = /(\d)\s*(?:stars?|estrellas?)/i.exec(label.replace(/ /g, ' '))
    if (pct && stars && +stars[1] >= 1 && +stars[1] <= 5) out[5 - Number(stars[1])] = Number(pct[1])
  }
  return out
}
