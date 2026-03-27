import type { PluginStorage } from '@openacp/plugin-sdk'

export interface UsageRecord {
  id: string
  sessionId: string
  agentName: string
  tokensUsed: number
  contextSize: number
  cost?: { amount: number; currency: string }
  timestamp: string
}

const DEBOUNCE_MS = 2000

export class UsageStore {
  private cache = new Map<string, UsageRecord[]>()
  private dirty = new Set<string>()
  private flushTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private storage: PluginStorage) {}

  async loadFromStorage(): Promise<void> {
    const key = this.monthKey(new Date().toISOString())
    const records = (await this.storage.get<UsageRecord[]>(key)) ?? []
    this.cache.set(key, records)
  }

  async append(record: UsageRecord): Promise<void> {
    const key = this.monthKey(record.timestamp)
    if (!this.cache.has(key)) {
      const existing = (await this.storage.get<UsageRecord[]>(key)) ?? []
      this.cache.set(key, existing)
    }
    this.cache.get(key)!.push(record)
    this.dirty.add(key)
    this.scheduleFlush()
  }

  getMonthlyTotal(date?: Date): { totalCost: number; currency: string } {
    const key = this.monthKey((date ?? new Date()).toISOString())
    const records = this.cache.get(key) ?? []
    const totalCost = records.reduce((sum, r) => sum + (r.cost?.amount ?? 0), 0)
    const currency = records.find(r => r.cost?.currency)?.cost?.currency ?? 'USD'
    return { totalCost, currency }
  }

  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    for (const key of this.dirty) {
      const records = this.cache.get(key)
      if (records) await this.storage.set(key, records)
    }
    this.dirty.clear()
  }

  async cleanupExpired(retentionDays: number): Promise<void> {
    const keys = await this.storage.list()
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - retentionDays)
    const cutoffKey = this.monthKey(cutoff.toISOString())

    for (const key of keys) {
      if (key.startsWith('records:') && key < cutoffKey) {
        await this.storage.delete(key)
        this.cache.delete(key)
      }
    }
  }

  destroy(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      this.flush()
    }, DEBOUNCE_MS)
  }

  private monthKey(timestamp: string): string {
    const d = new Date(timestamp)
    return `records:${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }
}
