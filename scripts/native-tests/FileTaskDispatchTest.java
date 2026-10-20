package com.vinoteapp;

import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

/** Real executor boundary used by picker result dispatch; no device claim. */
public class FileTaskDispatchTest {
  static void check(boolean value) { if (!value) throw new AssertionError(); }
  public static void main(String[] args) {
    ExecutorService worker = Executors.newSingleThreadExecutor();
    worker.shutdown();
    AtomicBoolean touched = new AtomicBoolean();
    check(!FileTaskDispatch.execute(worker, () -> touched.set(true)));
    check(!touched.get());
    check(FileTaskDispatch.execute(Runnable::run, () -> touched.set(true)));
    check(touched.get());
    for (String ext : new String[]{"mp4","mov","mkv","webm","avi","m4v"}) {
      check(OriginalFilePolicy.video("original." + ext.toUpperCase(), null));
      check(!OriginalFilePolicy.exportable(ext));
    }
    check(OriginalFilePolicy.video("disguised.m4a", "video/mp4"));
    for (String ext : new String[]{"m4a","aac","pdf","docx"}) {
      check(!OriginalFilePolicy.video("original." + ext, null));
      check(OriginalFilePolicy.exportable(ext));
    }
    System.out.println("FileTaskDispatch: shutdown rejects before IO; audio/document/video policy passed");
  }
}
