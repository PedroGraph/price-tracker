/**
 * Which products to buy with a budget: the combination that spends the most without going
 * over (so the money goes as far as possible), found exactly with a knapsack over whole cents
 * rounded to dollars. Ties prefer more products.
 */

export interface BudgetItem {
  asin: string
  price: number
  /** Lowest price in the last 30 days, to show what waiting could save. */
  low30: number | null
}

export interface BudgetPlan {
  chosen: BudgetItem[]
  total: number
  left: number
  /** Sum over the chosen items of how far each is above its 30-day low. */
  savingsIfWaiting: number
}

export function planBudget(items: BudgetItem[], budget: number): BudgetPlan {
  const valid = items.filter((i) => i.price > 0)
  const cap = Math.floor(budget)
  if (!(cap > 0) || valid.length === 0) return { chosen: [], total: 0, left: Math.max(0, budget), savingsIfWaiting: 0 }

  // Whole dollars (rounded up, so the plan never goes over): best[w] = best subset with cost ≤ w.
  const cost = valid.map((i) => Math.ceil(i.price))
  const best: { value: number; count: number; picks: number[] }[] = Array.from({ length: cap + 1 }, () => ({ value: 0, count: 0, picks: [] }))
  valid.forEach((item, idx) => {
    for (let w = cap; w >= cost[idx]; w--) {
      const prev = best[w - cost[idx]]
      const value = prev.value + item.price
      const count = prev.count + 1
      if (value > best[w].value + 1e-9 || (Math.abs(value - best[w].value) < 1e-9 && count > best[w].count)) {
        best[w] = { value, count, picks: [...prev.picks, idx] }
      }
    }
  })
  const chosen = best[cap].picks.map((i) => valid[i])
  const total = Math.round(chosen.reduce((s, i) => s + i.price, 0) * 100) / 100
  const savingsIfWaiting =
    Math.round(chosen.reduce((s, i) => s + (i.low30 !== null && i.low30 < i.price ? i.price - i.low30 : 0), 0) * 100) / 100
  return { chosen, total, left: Math.round((budget - total) * 100) / 100, savingsIfWaiting }
}
