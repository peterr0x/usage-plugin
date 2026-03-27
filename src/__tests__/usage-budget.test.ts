import { describe, it, expect, beforeEach, vi } from 'vitest'
import { UsageBudget } from '../usage-budget.js'
import type { UsageStore } from '../usage-store.js'

function mockStore(totalCost: number): UsageStore {
  return {
    getMonthlyTotal: () => ({ totalCost, currency: 'USD' }),
  } as unknown as UsageStore
}

describe('UsageBudget', () => {
  describe('check()', () => {
    it('returns ok when no budget configured', () => {
      const budget = new UsageBudget(mockStore(100), {})
      const result = budget.check()
      expect(result.status).toBe('ok')
      expect(result.message).toBeUndefined()
    })

    it('returns ok when under threshold', () => {
      const budget = new UsageBudget(mockStore(5), { monthlyBudget: 100, warningThreshold: 0.8 })
      const result = budget.check()
      expect(result.status).toBe('ok')
    })

    it('returns warning when at threshold', () => {
      const budget = new UsageBudget(mockStore(80), { monthlyBudget: 100, warningThreshold: 0.8 })
      const result = budget.check()
      expect(result.status).toBe('warning')
      expect(result.message).toContain('Budget Warning')
      expect(result.message).toContain('$80.00')
    })

    it('returns exceeded when at budget', () => {
      const budget = new UsageBudget(mockStore(100), { monthlyBudget: 100, warningThreshold: 0.8 })
      const result = budget.check()
      expect(result.status).toBe('exceeded')
      expect(result.message).toContain('Budget Exceeded')
    })

    it('de-duplicates: second call with same status returns no message', () => {
      const budget = new UsageBudget(mockStore(80), { monthlyBudget: 100, warningThreshold: 0.8 })
      budget.check()
      const result = budget.check()
      expect(result.status).toBe('warning')
      expect(result.message).toBeUndefined()
    })

    it('escalates: warning then exceeded emits both messages', () => {
      const store80 = mockStore(80)
      const budget = new UsageBudget(store80, { monthlyBudget: 100, warningThreshold: 0.8 })

      const r1 = budget.check()
      expect(r1.message).toBeDefined()

      ;(budget as any).store = mockStore(110)
      const r2 = budget.check()
      expect(r2.status).toBe('exceeded')
      expect(r2.message).toBeDefined()
    })

    it('resets de-duplication on month boundary', () => {
      const now = new Date(2026, 2, 15)
      const budget = new UsageBudget(
        mockStore(80),
        { monthlyBudget: 100, warningThreshold: 0.8 },
        () => now,
      )

      budget.check()

      now.setMonth(3)
      const result = budget.check()
      expect(result.message).toBeDefined()
    })
  })

  describe('getStatus()', () => {
    it('returns correct status fields', () => {
      const budget = new UsageBudget(mockStore(50), { monthlyBudget: 100, warningThreshold: 0.8 })
      const status = budget.getStatus()
      expect(status).toEqual({
        status: 'ok',
        used: 50,
        budget: 100,
        percent: 50,
      })
    })

    it('returns 0 percent when no budget', () => {
      const budget = new UsageBudget(mockStore(50), {})
      const status = budget.getStatus()
      expect(status.percent).toBe(0)
      expect(status.budget).toBe(0)
    })
  })
})
