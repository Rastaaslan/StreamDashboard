package com.rastaaslan.streamdashboard.remote;

import org.junit.Test;
import static org.junit.Assert.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

public class ProviderSchedulerTest {
  @Test public void statusDoesNotWaitForEffectsAndExpiredQueuedEffectsNeverStart() throws Exception {
    AtomicLong clock = new AtomicLong(100);
    ProviderScheduler queue = new ProviderScheduler(clock::get);
    CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1), status = new CountDownLatch(1), expired = new CountDownLatch(1);
    AtomicInteger effects = new AtomicInteger();
    try {
      queue.submit("first", "effects", 1000, () -> { entered.countDown(); try { release.await(2,TimeUnit.SECONDS); } catch(InterruptedException e) { Thread.currentThread().interrupt(); } }, () -> {});
      assertTrue(entered.await(1,TimeUnit.SECONDS));
      queue.submit("late", "effects", 200, effects::incrementAndGet, expired::countDown);
      queue.submit("status", "status", 1000, status::countDown, () -> {});
      assertTrue(status.await(1,TimeUnit.SECONDS));
      clock.set(201); release.countDown();
      assertTrue(expired.await(1,TimeUnit.SECONDS)); assertEquals(0,effects.get());
    } finally { release.countDown(); queue.close(); }
  }
  @Test public void cancellationCannotPretendToUndoAnEffect() throws Exception {
    ProviderScheduler queue = new ProviderScheduler(); long deadline=System.currentTimeMillis()+10000;
    CountDownLatch entered=new CountDownLatch(1),release=new CountDownLatch(1),cancelled=new CountDownLatch(1);
    AtomicInteger effects=new AtomicInteger();
    try {
      queue.submit("active","effects",deadline,()->{entered.countDown();try{release.await(2,TimeUnit.SECONDS);}catch(InterruptedException e){Thread.currentThread().interrupt();}},()->{});
      assertTrue(entered.await(1,TimeUnit.SECONDS)); assertFalse(queue.cancel("active"));
      queue.submit("queued","effects",deadline,effects::incrementAndGet,cancelled::countDown);
      assertTrue(queue.cancel("queued"));release.countDown();assertTrue(cancelled.await(1,TimeUnit.SECONDS));assertEquals(0,effects.get());
    } finally { release.countDown();queue.close(); }
  }
}
