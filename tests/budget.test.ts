import { describe, expect, it } from 'vitest'
import { planBudget } from '../src/shared/budget'

const item = (asin: string, price: number, low30: number | null = null) => ({ asin, price, low30 })

describe('planBudget', () => {
  it('spends as much of the budget as possible without going over', () => {
    const plan = planBudget([item('a', 600), item('b', 500), item('c', 450)], 1000)
    expect(plan.chosen.map((i) => i.asin).sort()).toEqual(['b', 'c'])
    expect(plan.total).toBe(950)
    expect(plan.left).toBe(50)
  })

  it('never goes over because of cents', () => {
    const plan = planBudget([item('a', 99.99), item('b', 0.5)], 100)
    expect(plan.total).toBeLessThanOrEqual(100)
  })

  it('adds up what waiting for the 30-day low would save', () => {
    const plan = planBudget([item('a', 100, 90), item('b', 50, 50)], 200)
    expect(plan.savingsIfWaiting).toBe(10)
  })

  it('handles an empty list or no budget', () => {
    expect(planBudget([], 100).chosen).toEqual([])
    expect(planBudget([item('a', 10)], 0).chosen).toEqual([])
  })
})
