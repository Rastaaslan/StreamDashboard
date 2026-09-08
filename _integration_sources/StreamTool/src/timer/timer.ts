export class DeadlineTimer {
  private startedAtValue: number | null = null;
  private deadlineValue: number | null = null;
  private durationValue = 0;
  private pausedRemaining: number | null = null;
  constructor(private readonly now: () => number = Date.now) {}
  get startedAt() { return this.startedAtValue; }
  get deadline() { return this.deadlineValue; }
  get duration() { return this.durationValue; }
  get running() { return this.deadlineValue !== null; }
  get remaining() {
    if (this.deadlineValue !== null) return Math.max(0, Math.ceil((this.deadlineValue - this.now()) / 1000));
    return this.pausedRemaining ?? this.durationValue;
  }
  start(seconds: number) { this.validate(seconds); this.durationValue = seconds; this.startedAtValue = this.now(); this.deadlineValue = this.now() + seconds * 1000; this.pausedRemaining = null; }
  pause() { if (!this.running) throw new Error('Timer is not running'); this.pausedRemaining = this.remaining; this.deadlineValue = null; }
  resume() { if (this.pausedRemaining === null) throw new Error('Timer is not paused'); this.startedAtValue = this.now(); this.deadlineValue = this.now() + this.pausedRemaining * 1000; this.pausedRemaining = null; }
  reset() { if (!this.durationValue) throw new Error('No timer to reset'); this.start(this.durationValue); }
  add(seconds: number) { if (!Number.isInteger(seconds) || seconds === 0) throw new Error('seconds must be a non-zero integer'); const next = Math.max(0, this.remaining + seconds); this.durationValue = Math.max(0, this.durationValue + seconds); if (this.running) this.deadlineValue = this.now() + next * 1000; else this.pausedRemaining = next; }
  set(seconds: number) { this.validate(seconds); this.durationValue = seconds; if (this.running) this.deadlineValue = this.now() + seconds * 1000; else this.pausedRemaining = seconds; }
  stop() { this.startedAtValue = null; this.deadlineValue = null; this.durationValue = 0; this.pausedRemaining = null; }
  private validate(seconds: number) { if (!Number.isInteger(seconds) || seconds <= 0 || seconds > 86400) throw new Error('seconds must be an integer between 1 and 86400'); }
}
