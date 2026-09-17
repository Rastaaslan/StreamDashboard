import type { EventEnvelope } from '../../contracts/src/index.js';
import { matchAutomation, type Automation } from './live-control-domains.js';

export interface AutomationExecution {
  automationId: string;
  correlationId: string;
  status: 'succeeded' | 'failed';
  startedAt: string;
  completedAt: string;
  error?: string;
}

export class AutomationEngine {
  private readonly automations = new Map<string, Automation>();
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly executeAction: (action: Automation['actions'][number], context: { correlationId: string; automationId: string; actionIndex: number }) => Promise<void>, private readonly now = () => new Date()) {}

  replace(values: Automation[]) {
    const unique = new Map<string, Automation>();
    for (const value of values) {
      if (!/^[A-Za-z0-9._:-]{1,100}$/.test(value.id) || unique.has(value.id)) throw new Error('Automation id invalide ou dupliqué.');
      if (!value.name?.trim() || value.name.length > 120) throw new Error('Automation name invalide.');
      if (!value.actions.length || value.actions.length > 20 || value.conditions.length > 20) throw new Error('Automation trop complexe.');
      unique.set(value.id, structuredClone(value));
    }
    this.automations.clear(); for (const [id, value] of unique) this.automations.set(id, value);
  }

  list() { return [...this.automations.values()].map(value => structuredClone(value)); }

  consume(event: EventEnvelope): Promise<AutomationExecution[]> {
    const result = this.queue.then(() => this.run(event));
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async run(event: EventEnvelope) {
    const executions: AutomationExecution[] = [];
    for (const automation of this.automations.values()) {
      const startedAt = this.now().toISOString();
      if (!matchAutomation(automation, event, Date.parse(startedAt))) continue;
      try {
        for (const [actionIndex, action] of automation.actions.entries()) await this.executeAction(action, { correlationId: event.correlationId, automationId: automation.id, actionIndex });
        automation.lastExecutionAt = this.now().toISOString();
        automation.lastResult = { status: 'succeeded', at: automation.lastExecutionAt };
        executions.push({ automationId: automation.id, correlationId: event.correlationId, status: 'succeeded', startedAt, completedAt: automation.lastExecutionAt });
      } catch (error) {
        const completedAt = this.now().toISOString();
        automation.lastResult = { status: 'failed', at: completedAt, error: error instanceof Error ? error.message : String(error) };
        executions.push({ automationId: automation.id, correlationId: event.correlationId, status: 'failed', startedAt, completedAt, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return executions;
  }
}
