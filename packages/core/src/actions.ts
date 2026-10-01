import { randomUUID } from 'node:crypto';
import type { ActionCommand, CommandAcknowledgement } from '../../contracts/src/index.js';

type Handler<TPayload> = (command: ActionCommand<TPayload>) => Promise<void>;

export class ActionCore {
  private readonly completed = new Map<string, CommandAcknowledgement>();
  private readonly inFlight = new Map<string, Promise<CommandAcknowledgement>>();

  constructor(private readonly retention = 1_000, private readonly now = () => new Date()) {}

  execute<TPayload>(command: ActionCommand<TPayload>, handler: Handler<TPayload>): Promise<CommandAcknowledgement> {
    this.validate(command);
    const completed = this.completed.get(command.commandId);
    if (completed) return Promise.resolve(completed);
    const current = this.inFlight.get(command.commandId);
    if (current) return current;
    const correlationId = command.correlationId ?? randomUUID();
    const execution = handler({ ...command, correlationId }).then(
      () => this.ack(command.commandId, correlationId, 'succeeded'),
      error => this.ack(command.commandId, correlationId, 'failed', error),
    ).then(ack => {
      this.inFlight.delete(command.commandId);
      this.completed.set(command.commandId, ack);
      while (this.completed.size > this.retention) this.completed.delete(this.completed.keys().next().value!);
      return ack;
    });
    this.inFlight.set(command.commandId, execution);
    return execution;
  }

  private ack(commandId: string, correlationId: string, status: 'succeeded' | 'failed', error?: unknown): CommandAcknowledgement {
    const normalized = error instanceof Error ? error : new Error(String(error ?? ''));
    return {
      commandId, correlationId, status, timestamp: this.now().toISOString(),
      ...(status === 'failed' ? { errorCode: normalized.name === 'Error' ? 'COMMAND_FAILED' : normalized.name, message: normalized.message } : {}),
    };
  }

  private validate(command: ActionCommand<unknown>) {
    if (!command || typeof command !== 'object') throw new Error('Commande invalide.');
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(command.commandId)) throw new Error('commandId invalide.');
    if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(command.type) || command.type.length > 120) throw new Error('type invalide.');
    if (!Number.isFinite(Date.parse(command.issuedAt))) throw new Error('issuedAt invalide.');
  }
}
