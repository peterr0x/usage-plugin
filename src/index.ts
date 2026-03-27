import type { OpenACPPlugin, PluginContext, InstallContext, MigrateContext } from '@openacp/plugin-sdk'
import { nanoid } from 'nanoid'
import { UsageStore } from './usage-store.js'
import { UsageBudget } from './usage-budget.js'
import type { UsageRecord } from './usage-store.js'

interface UsageRecordEvent {
  sessionId: string
  agentName: string
  timestamp: string
  tokensUsed: number
  contextSize: number
  cost?: { amount: number; currency: string }
}

interface NotificationService {
  notifyAll(notification: {
    sessionId: string
    sessionName?: string
    type: string
    summary: string
  }): Promise<void>
}

let _store: UsageStore | null = null

const plugin: OpenACPPlugin = {
  name: '@openacp/usage-plugin',
  version: '0.1.0',
  description: 'Automatically tracks token usage and cost per agent session, supports configurable monthly budgets with warning notifications, and auto-cleans old records based on a retention policy.',
  permissions: ['events:read', 'services:use', 'services:register', 'commands:register', 'storage:read', 'storage:write'],

  async setup(ctx: PluginContext): Promise<void> {
    const config = ctx.pluginConfig as Record<string, unknown>
    _store = new UsageStore(ctx.storage)
    const store = _store
    const budget = new UsageBudget(store, {
      monthlyBudget: config.monthlyBudget as number | undefined,
      warningThreshold: config.warningThreshold as number | undefined,
      retentionDays: config.retentionDays as number | undefined,
    })

    // Load existing records into memory
    await store.loadFromStorage()

    // Clean old records
    const retentionDays = (config.retentionDays as number) ?? 90
    await store.cleanupExpired(retentionDays)

    // Listen to usage events from core
    ctx.on('usage:recorded', async (...args: unknown[]) => {
      const event = args[0] as UsageRecordEvent
      const record: UsageRecord = {
        id: nanoid(),
        ...event,
      }
      await store.append(record)

      const result = budget.check()
      if (result.message) {
        const notifications = ctx.getService<NotificationService>('notifications')
        if (notifications) {
          await notifications.notifyAll({
            sessionId: event.sessionId,
            type: 'budget_warning',
            summary: result.message,
          })
        }
      }
    })

    // Register /usage command
    ctx.registerCommand({
      name: 'usage',
      description: 'Show usage summary for current month',
      category: 'plugin',
      handler: async () => {
        const status = budget.getStatus()
        const lines = [
          'Usage (this month):',
          `  Spent: $${status.used.toFixed(2)}`,
          `  Budget: ${status.budget > 0 ? `$${status.budget.toFixed(2)}` : 'not set'}`,
          `  Status: ${status.status} (${status.percent}%)`,
        ]
        return { type: 'text', text: lines.join('\n') }
      },
    })

    // Expose service for other plugins
    ctx.registerService('usage', { store, budget })

    ctx.log.info('Usage tracking ready')
  },

  async teardown(): Promise<void> {
    if (_store) {
      await _store.flush()
      _store.destroy()
      _store = null
    }
  },

  async install(ctx: InstallContext): Promise<void> {
    const { settings, legacyConfig, terminal } = ctx

    // Migrate from legacy config if present
    if (legacyConfig) {
      const usageCfg = legacyConfig.usage as Record<string, unknown> | undefined
      if (usageCfg) {
        await settings.setAll({
          enabled: usageCfg.enabled ?? true,
          monthlyBudget: usageCfg.monthlyBudget ?? 0,
          warningThreshold: usageCfg.warningThreshold ?? 0.8,
          retentionDays: usageCfg.retentionDays ?? 90,
        })
        terminal.log.success('Usage settings migrated from legacy config')
        return
      }
    }

    await settings.setAll({
      enabled: true,
      monthlyBudget: 0,
      warningThreshold: 0.8,
      retentionDays: 90,
    })
    terminal.log.success('Usage defaults saved')
  },

  async configure(ctx: InstallContext): Promise<void> {
    const { terminal, settings } = ctx
    const current = await settings.getAll()

    const choice = await terminal.select({
      message: 'What to configure?',
      options: [
        { value: 'budget', label: `Monthly budget (current: $${current.monthlyBudget ?? 0})` },
        { value: 'threshold', label: `Warning threshold (current: ${current.warningThreshold ?? 0.8})` },
        { value: 'retention', label: `Retention days (current: ${current.retentionDays ?? 90})` },
        { value: 'done', label: 'Done' },
      ],
    })

    if (choice === 'budget') {
      const val = await terminal.text({
        message: 'Monthly budget in USD (0 = no limit):',
        defaultValue: String(current.monthlyBudget ?? 0),
        validate: (v) => {
          const n = Number(v.trim())
          if (isNaN(n) || n < 0) return 'Must be a non-negative number'
          return undefined
        },
      })
      await settings.set('monthlyBudget', Number(val.trim()))
      terminal.log.success('Monthly budget updated')
    } else if (choice === 'threshold') {
      const val = await terminal.text({
        message: 'Warning threshold (0-1):',
        defaultValue: String(current.warningThreshold ?? 0.8),
        validate: (v) => {
          const n = Number(v.trim())
          if (isNaN(n) || n < 0 || n > 1) return 'Must be between 0 and 1'
          return undefined
        },
      })
      await settings.set('warningThreshold', Number(val.trim()))
      terminal.log.success('Warning threshold updated')
    } else if (choice === 'retention') {
      const val = await terminal.text({
        message: 'Retention days:',
        defaultValue: String(current.retentionDays ?? 90),
        validate: (v) => {
          const n = Number(v.trim())
          if (isNaN(n) || n < 1) return 'Must be a positive number'
          return undefined
        },
      })
      await settings.set('retentionDays', Number(val.trim()))
      terminal.log.success('Retention days updated')
    }
  },

  async migrate(_ctx: MigrateContext, oldSettings: unknown, _oldVersion: string): Promise<unknown> {
    return oldSettings
  },

  async uninstall(ctx: InstallContext, opts: { purge: boolean }): Promise<void> {
    if (opts.purge) {
      await ctx.settings.clear()
    }
    ctx.terminal.log.success('Usage plugin removed')
  },
}

export default plugin
