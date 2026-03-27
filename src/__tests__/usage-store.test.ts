import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { UsageStore } from '../usage-store.js'
import type { PluginStorage } from '@openacp/plugin-sdk'

interface UsageRecord {
  id: string
  sessionId: string
  agentName: string
  tokensUsed: number
  contextSize: number
  cost?: { amount: number; currency: string }
  timestamp: string
}

function makeRecord(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    id: 'rec-1',
    sessionId: 'sess-1',
    agentName: 'claude',
    tokensUsed: 1000,
    contextSize: 50000,
    cost: { amount: 0.05, currency: 'USD' },
    timestamp: new Date().toISOString(),
    ...overrides,
  }
}

function createMockStorage(): PluginStorage & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>()
  return {
    data,
    async get<T>(key: string): Promise<T | undefined> {
      return data.get(key) as T | undefined
    },
    async set<T>(key: string, value: T): Promise<void> {
      data.set(key, value)
    },
    async delete(key: string): Promise<void> {
      data.delete(key)
    },
    async list(): Promise<string[]> {
      return Array.from(data.keys())
    },
    getDataDir(): string {
      return '/tmp/test-data'
    },
  }
}

describe('UsageStore', () => {
  let storage: ReturnType<typeof createMockStorage>
  let store: UsageStore

  beforeEach(() => {
    vi.useFakeTimers()
    storage = createMockStorage()
    store = new UsageStore(storage)
  })

  afterEach(() => {
    store.destroy()
    vi.useRealTimers()
  })

  it('appends record to in-memory cache', async () => {
    const record = makeRecord()
    await store.append(record)

    const total = store.getMonthlyTotal()
    expect(total.totalCost).toBe(0.05)
    expect(total.currency).toBe('USD')
  })

  it('does not flush to storage immediately', async () => {
    await store.append(makeRecord())
    expect(storage.data.size).toBe(0)
  })

  it('flushes to storage after debounce period', async () => {
    await store.append(makeRecord())
    vi.advanceTimersByTime(2000)
    await vi.runAllTimersAsync()

    expect(storage.data.size).toBe(1)
  })

  it('flush() writes all dirty keys immediately', async () => {
    await store.append(makeRecord())
    await store.flush()

    expect(storage.data.size).toBe(1)
    const key = Array.from(storage.data.keys())[0]
    expect(key).toMatch(/^records:\d{4}-\d{2}$/)
    const records = storage.data.get(key) as UsageRecord[]
    expect(records).toHaveLength(1)
  })

  it('accumulates multiple records in same month', async () => {
    await store.append(makeRecord({ id: 'r1', cost: { amount: 0.05, currency: 'USD' } }))
    await store.append(makeRecord({ id: 'r2', cost: { amount: 0.10, currency: 'USD' } }))

    const total = store.getMonthlyTotal()
    expect(total.totalCost).toBeCloseTo(0.15)
  })

  it('loads existing records from storage on loadFromStorage()', async () => {
    const now = new Date()
    const key = `records:${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    storage.data.set(key, [makeRecord({ cost: { amount: 1.00, currency: 'USD' } })])

    await store.loadFromStorage()
    const total = store.getMonthlyTotal()
    expect(total.totalCost).toBe(1.00)
  })

  it('getMonthlyTotal returns 0 when no records', () => {
    const total = store.getMonthlyTotal()
    expect(total.totalCost).toBe(0)
    expect(total.currency).toBe('USD')
  })

  it('getMonthlyTotal handles records without cost', async () => {
    await store.append(makeRecord({ cost: undefined }))
    const total = store.getMonthlyTotal()
    expect(total.totalCost).toBe(0)
  })

  it('cleanupExpired removes old month keys', async () => {
    const oldDate = new Date()
    oldDate.setMonth(oldDate.getMonth() - 6)
    const oldKey = `records:${oldDate.getFullYear()}-${String(oldDate.getMonth() + 1).padStart(2, '0')}`
    storage.data.set(oldKey, [makeRecord()])

    await store.append(makeRecord())
    await store.flush()

    await store.cleanupExpired(90)

    expect(storage.data.has(oldKey)).toBe(false)
    expect(storage.data.size).toBe(1)
  })
})
