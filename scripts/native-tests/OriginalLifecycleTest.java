package com.vinoteapp;

import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

/** Exercises the same gate and executor boundary used by Android; no device claims. */
public class OriginalLifecycleTest {
  static void check(boolean value) { if (!value) throw new AssertionError(); }
  public static void main(String[] args) {
    OriginalLifecycle gate = new OriginalLifecycle();
    String old = gate.issue("alice");
    check(gate.valid(old, "alice"));
    gate.revoke(); // Account closes preview BEFORE its Activity.onCreate.
    check(!gate.valid(old, "alice"));
    String next = gate.issue("bob");
    check(!gate.valid(old, "alice") && !gate.valid(next, "alice"));
    check(gate.valid(next, "bob"));
    String aba = gate.issue("alice");
    check(!gate.valid(old, "alice") && !gate.valid(next, "bob"));
    check(gate.valid(aba, "alice"));
    gate.revoke(); // Also forbids a stopped Activity from restarting playback.
    check(!gate.valid(aba, "alice"));
    ExecutorService worker = Executors.newSingleThreadExecutor();
    worker.shutdown();
    AtomicBoolean touchedDestination = new AtomicBoolean();
    check(!OriginalLifecycle.execute(worker, () -> touchedDestination.set(true)));
    check(!touchedDestination.get());
    check(OriginalLifecycle.execute(Runnable::run, () -> touchedDestination.set(true)));
    check(touchedDestination.get());
    System.out.println("OriginalLifecycle: delayed launch, owner/ABA, restart and shutdown rejection passed");
  }
}
