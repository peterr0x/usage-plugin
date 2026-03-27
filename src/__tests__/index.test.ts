import { describe, it, expect } from 'vitest'
import { createTestContext } from '@openacp/plugin-sdk/testing'
import plugin from '../index.js'

describe('@openacp/usage-plugin', () => {
  it('has correct metadata', () => {
    expect(plugin.name).toBe('@openacp/usage-plugin')
    expect(plugin.version).toBeDefined()
    expect(plugin.permissions).toContain('events:read')
    expect(plugin.permissions).toContain('services:use')
    expect(plugin.permissions).toContain('services:register')
    expect(plugin.permissions).toContain('commands:register')
    expect(plugin.permissions).toContain('storage:read')
    expect(plugin.permissions).toContain('storage:write')
  })

  describe('setup', () => {
    it('registers usage service', async () => {
      const ctx = createTestContext({
        pluginName: '@openacp/usage-plugin',
        pluginConfig: {},
        permissions: plugin.permissions,
      })
      await plugin.setup(ctx)

      expect(ctx.registeredServices.has('usage')).toBe(true)
    })

    it('registers /usage command', async () => {
      const ctx = createTestContext({
        pluginName: '@openacp/usage-plugin',
        pluginConfig: {},
        permissions: plugin.permissions,
      })
      await plugin.setup(ctx)

      expect(ctx.registeredCommands.has('usage')).toBe(true)
    })

    it('tracks usage on usage:recorded event', async () => {
      const ctx = createTestContext({
        pluginName: '@openacp/usage-plugin',
        pluginConfig: { monthlyBudget: 100, warningThreshold: 0.8 },
        permissions: plugin.permissions,
      })
      await plugin.setup(ctx)

      ctx.emit('usage:recorded', {
        sessionId: 'sess-1',
        agentName: 'claude',
        timestamp: new Date().toISOString(),
        tokensUsed: 1000,
        contextSize: 50000,
        cost: { amount: 0.05, currency: 'USD' },
      })

      // Wait for async handler
      await new Promise(resolve => setTimeout(resolve, 10))

      const response = await ctx.executeCommand('usage')
      expect(response).toBeDefined()
      expect((response as any).text).toContain('$0.05')
    })

    it('calls notification service when budget warning triggered', async () => {
      const notifyAllCalls: unknown[] = []
      const ctx = createTestContext({
        pluginName: '@openacp/usage-plugin',
        pluginConfig: { monthlyBudget: 0.10, warningThreshold: 0.8 },
        permissions: plugin.permissions,
        services: {
          notifications: {
            notifyAll: async (msg: unknown) => { notifyAllCalls.push(msg) },
            notify: async () => {},
          },
        },
      })
      await plugin.setup(ctx)

      ctx.emit('usage:recorded', {
        sessionId: 'sess-1',
        agentName: 'claude',
        timestamp: new Date().toISOString(),
        tokensUsed: 5000,
        contextSize: 50000,
        cost: { amount: 0.09, currency: 'USD' },
      })

      await new Promise(resolve => setTimeout(resolve, 10))

      expect(notifyAllCalls).toHaveLength(1)
      expect((notifyAllCalls[0] as any).type).toBe('budget_warning')
      expect((notifyAllCalls[0] as any).summary).toContain('Budget Warning')
    })
  })

  describe('/usage command', () => {
    it('shows no budget when not configured', async () => {
      const ctx = createTestContext({
        pluginName: '@openacp/usage-plugin',
        pluginConfig: {},
        permissions: plugin.permissions,
      })
      await plugin.setup(ctx)

      const response = await ctx.executeCommand('usage')
      expect(response).toBeDefined()
      expect((response as any).text).toContain('$0.00')
      expect((response as any).text).toContain('not set')
    })
  })
})
