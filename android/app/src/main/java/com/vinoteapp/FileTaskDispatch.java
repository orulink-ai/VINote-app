package com.vinoteapp;

import java.util.concurrent.Executor;
import java.util.concurrent.RejectedExecutionException;

/** Shutdown must settle a picker result without starting file IO or crashing. */
final class FileTaskDispatch {
  static boolean execute(Executor executor, Runnable action) {
    try { executor.execute(action); return true; }
    catch (RejectedExecutionException rejected) { return false; }
  }
}
