package com.rastaaslan.streamdashboard.remote;

import java.util.Map;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.LongSupplier;

/** Mutations remain ordered. Local status and independent chat reads cannot
 * sit behind a publication. Expiry/cancellation is checked before admission
 * to the effect, never interpreted as rollback of an effect already started. */
final class ProviderScheduler implements AutoCloseable {
  private final Map<String, ThreadPoolExecutor> lanes = new ConcurrentHashMap<>();
  private final Map<String, Ticket> tickets = new ConcurrentHashMap<>();
  private final LongSupplier clock;
  private final AtomicBoolean closed = new AtomicBoolean();
  ProviderScheduler() { this(System::currentTimeMillis); }
  ProviderScheduler(LongSupplier clock) { this.clock = clock; }
  private static final class Ticket { boolean started, cancelled; }
  synchronized void submit(String id, String lane, long deadline, Runnable work, Runnable expired) {
    if (closed.get() || deadline <= clock.getAsLong()) throw new RejectedExecutionException("EXPIRED");
    Ticket ticket = new Ticket();
    if (tickets.putIfAbsent(id, ticket) != null) throw new RejectedExecutionException("DUPLICATE");
    try {
      ThreadPoolExecutor executor = lanes.computeIfAbsent(lane, key -> new ThreadPoolExecutor(
        1, 1, 30, TimeUnit.SECONDS, new ArrayBlockingQueue<Runnable>(32), runnable -> {
          Thread thread = new Thread(runnable, "provider-" + key); thread.setDaemon(true); return thread;
        }));
      executor.execute(() -> {
        boolean run;
        synchronized (ticket) {
          run = !closed.get() && !ticket.cancelled && clock.getAsLong() < deadline;
          ticket.started = run;
        }
        try { if (run) work.run(); else expired.run(); }
        finally { tickets.remove(id, ticket); }
      });
    } catch (RuntimeException error) { tickets.remove(id, ticket); throw error; }
  }
  boolean cancel(String id) {
    Ticket ticket = tickets.get(id);
    if (ticket == null) return false;
    synchronized (ticket) { if (ticket.started) return false; ticket.cancelled = true; return true; }
  }
  public synchronized void close() {
    closed.set(true);
    for (Ticket ticket : tickets.values()) synchronized(ticket) { ticket.cancelled = true; }
    // Do not interrupt a network effect and incorrectly report it as unexecuted.
    lanes.values().forEach(ThreadPoolExecutor::shutdown);
  }
}
