/** In-process shutdown boundary for event producers, not an installer lock.
 * Stop admission synchronously, then settle every accepted operation including
 * its final persistence. A failed storage attempt stays uncertain; a rejected
 * validation/observation before storage is not misreported as a disk failure.
 * No timeout, retry, process termination or reopening of a stopped producer.
 */
export class RuntimeProducerDrain {
  private readonly pending = new Set<Promise<unknown>>();
  private closing = false;
  private uncertain = false;
  private stopping: Promise<void> | undefined;
  constructor(private readonly uncertaintyCode: string) {}
  get stopped() { return this.closing; }

  run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new Error('RUNTIME_PRODUCER_STOPPED'));
    // Register before calling out: even a synchronous/reentrant stop observes
    // this accepted operation, not an apparently idle producer.
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason: unknown) => void;
    const work = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    this.pending.add(work);
    void work.then(() => this.pending.delete(work), () => this.pending.delete(work));
    try { resolve(operation()); } catch (error) { reject(error); }
    return work;
  }

  /** Storage substep of an already accepted run(). It may finish while stop
   * waits; never cancel a possibly committed write or retry on a lost receipt. */
  async persist<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) { this.uncertain = true; throw error; }
  }

  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.closing = true;
    this.stopping = Promise.allSettled([...this.pending]).then(() => {
      if (this.uncertain) throw new Error(this.uncertaintyCode);
    });
    return this.stopping;
  }
}
