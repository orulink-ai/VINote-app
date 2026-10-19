package com.vinoteapp;

import java.io.*;
import java.util.Arrays;

/** Offline JVM counterexamples; Android provider/codec acceptance is separate. */
public class OriginalCopyTest {
  static void require(boolean value) { if (!value) throw new AssertionError(); }
  public static void main(String[] args) throws Exception {
    byte[] original = new byte[3 * 65536 + 17];
    for (int i = 0; i < original.length; i++) original[i] = (byte) i;
    ByteArrayOutputStream saved = new ByteArrayOutputStream();
    OriginalCopy.copyEmptyTarget(0, new ByteArrayInputStream(original), saved, original.length, () -> true);
    require(Arrays.equals(original, saved.toByteArray()));

    ByteArrayOutputStream existing = new ByteArrayOutputStream(); existing.write(new byte[]{1,2,3});
    try { OriginalCopy.copyEmptyTarget(3, new ByteArrayInputStream(original), existing, original.length, () -> true); throw new AssertionError(); }
    catch (IOException expected) { require(Arrays.equals(existing.toByteArray(), new byte[]{1,2,3})); }

    ByteArrayOutputStream cancelled = new ByteArrayOutputStream();
    try { OriginalCopy.copyEmptyTarget(0, new ByteArrayInputStream(original), cancelled, original.length, () -> false); throw new AssertionError(); }
    catch (IOException expected) { require(cancelled.size() == 0); }

    try { OriginalCopy.copyEmptyTarget(-1, new ByteArrayInputStream(original), new ByteArrayOutputStream(), original.length, () -> true); throw new AssertionError(); }
    catch (IOException expected) { /* An unstatable provider is never truncated. */ }

    try { OriginalCopy.copyEmptyTarget(0, new ByteArrayInputStream(new byte[]{1}), new ByteArrayOutputStream(), 2, () -> true); throw new AssertionError(); }
    catch (IOException expected) { /* Short input is not successful. */ }

    File directory = new File(args[0]); require(directory.isDirectory());
    File partial = new File(directory, "partial-copy.bin");
    try (OutputStream output = new FileOutputStream(partial)) {
      InputStream broken = new InputStream() {
        int reads;
        public int read() throws IOException { if (reads++ > 100) throw new IOException("synthetic"); return 42; }
      };
      try { OriginalCopy.copyEmptyTarget(0, broken, output, original.length, () -> true); throw new AssertionError(); }
      catch (IOException expected) { require(partial.exists()); }
    }
    System.out.println("OriginalCopy: 6 counterexamples passed; no delete capability");
  }
}
