package com.vinoteapp;

import java.util.UUID;
import java.util.concurrent.Executor;
import java.util.concurrent.RejectedExecutionException;

/** Process-local, revocable preview authority; never reconstructed from an Intent. */
final class OriginalLifecycle {
  private String ticket;
  private String owner;
  synchronized String issue(String account) {
    owner = account;
    ticket = UUID.randomUUID().toString();
    return ticket;
  }
  synchronized void revoke() { ticket = null; owner = null; }
  synchronized boolean valid(String candidate, String account) {
    return ticket != null && ticket.equals(candidate) && owner.equals(account);
  }
  static boolean execute(Executor executor, Runnable action) {
    try { executor.execute(action); return true; }
    catch (RejectedExecutionException rejected) { return false; }
  }
}
