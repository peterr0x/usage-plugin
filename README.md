# @peterr0x/usage-plugin

An [OpenACP](https://github.com/Open-ACP/OpenACP) plugin that automatically tracks token usage and cost per agent session, supports configurable monthly budgets with warning notifications, and auto-cleans old records based on a retention policy.

## How it works

```
Core (SessionFactory)          Event Bus              Usage Plugin
─────────────────────         ─────────              ────────────
agent_event (type=usage) ──→  usage:recorded  ──→    on('usage:recorded')
                                                      │
                                                      ├─ buffer in memory
                                                      ├─ debounced flush to storage
                                                      ├─ budget check
                                                      │
                                                      └─ notifications.notifyAll(...)
```

Core emits `usage:recorded` on the event bus whenever an agent reports token usage. The plugin listens, stores records (month-partitioned, in-memory cache with debounced writes), checks budget thresholds, and calls the notifications service when a warning or exceeded status is triggered.

## Commands

| Command  | Description                         |
| -------- | ----------------------------------- |
| `/usage` | Show usage summary for current month |

## Configuration

| Setting            | Default | Description                                  |
| ------------------ | ------- | -------------------------------------------- |
| `monthlyBudget`    | `0`     | Monthly budget in USD (0 = no limit)         |
| `warningThreshold` | `0.8`   | Trigger warning at this % of budget (0-1)    |
| `retentionDays`    | `90`    | How long to keep usage records               |

Configure interactively:

```bash
openacp plugin configure @peterr0x/usage-plugin
```

## Permissions

| Permission          | Why                                                  |
| ------------------- | ---------------------------------------------------- |
| `events:read`       | Listens to `usage:recorded` events from core         |
| `services:use`      | Calls `notifications` service for budget alerts      |
| `services:register` | Exposes `usage` service for other plugins            |
| `commands:register` | Registers the `/usage` command                       |
| `storage:read`      | Reads usage records from plugin storage              |
| `storage:write`     | Writes usage records to plugin storage               |

## Installation

```bash
npm install @peterr0x/usage-plugin
```

## License

MIT
