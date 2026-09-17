import { randomUUID } from 'node:crypto';
import type { EventEnvelope } from '../../../packages/contracts/src/index.js';
import { AutomationEngine, type AutomationExecution } from '../../../packages/core/src/automation-engine.js';
import type { Automation } from '../../../packages/core/src/live-control-domains.js';

export class AutomationRuntime {
  private readonly engine: AutomationEngine;
  private executions: AutomationExecution[] = [];

  constructor(initial: Automation[], executeAction: ConstructorParameters<typeof AutomationEngine>[0], private readonly persist: (values: Automation[]) => Promise<void>) {
    this.engine = new AutomationEngine(executeAction);
    this.engine.replace(initial);
  }

  list() { return this.engine.list(); }

  async create(input: Omit<Automation, 'id' | 'lastExecutionAt' | 'lastResult'> & { id?: string }) {
    const value: Automation = { ...structuredClone(input), id: input.id ?? randomUUID(), lastExecutionAt: null, lastResult: null };
    await this.replace([...this.list(), value]); return value;
  }

  async update(id: string, patch: Partial<Omit<Automation, 'id' | 'lastExecutionAt' | 'lastResult'>>) {
    const values = this.list(); const index = values.findIndex(value => value.id === id); if (index < 0) throw named('AUTOMATION_NOT_FOUND', 'Automation introuvable.');
    values[index] = { ...values[index]!, ...structuredClone(patch), id };
    await this.replace(values); return values[index]!;
  }

  async remove(id: string) { const values = this.list(); if (!values.some(value => value.id === id)) throw named('AUTOMATION_NOT_FOUND', 'Automation introuvable.'); await this.replace(values.filter(value => value.id !== id)); }

  async consume(event: EventEnvelope) {
    const result = await this.engine.consume(event);
    if (result.length) { this.executions = [...result, ...this.executions].slice(0, 100); await this.persist(this.list()); }
    return result;
  }

  recent() { return structuredClone(this.executions); }
  private async replace(values: Automation[]) { this.engine.replace(values); await this.persist(this.list()); }
}

function named(name: string, message: string) { const error = new Error(message); error.name = name; return error; }
