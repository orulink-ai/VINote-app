package com.vinoteapp;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.function.BooleanSupplier;

/** A non-truncating, bounded copy; no destination delete/rename capability. */
final class OriginalCopy {
  static void copyEmptyTarget(long targetSize, InputStream input, OutputStream output,
      long expectedSize, BooleanSupplier current) throws IOException {
    if (targetSize != 0 || expectedSize <= 0) throw new IOException("Target must be a new empty file");
    byte[] buffer = new byte[65536];
    long copied = 0;
    while (true) {
      if (!current.getAsBoolean()) throw new IOException("Export cancelled");
      int count = input.read(buffer);
      if (count < 0) break;
      copied += count;
      if (copied > expectedSize) throw new IOException("Source changed");
      output.write(buffer, 0, count);
    }
    if (copied != expectedSize || !current.getAsBoolean()) throw new IOException("Incomplete export");
    output.flush();
  }
}
