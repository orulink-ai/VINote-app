package com.vinoteapp;

import java.io.File;
import java.io.IOException;

/** Only the trusted Context.filesDir itself may have an OS alias. */
final class OriginalPathPolicy {
  static File requireFile(File filesDir, File source, String encodedOwner) throws IOException {
    if (encodedOwner.isEmpty() || encodedOwner.equals(".") || encodedOwner.equals("..") ||
        encodedOwner.contains("/") || encodedOwner.contains("\\"))
      throw new IllegalArgumentException("ORIGINAL_OWNER_SEGMENT");
    File input = source.getAbsoluteFile();
    String filename = input.getName();
    if (!filename.matches("[a-zA-Z0-9-]+\\.[a-z0-9]{1,8}"))
      throw new IllegalArgumentException("ORIGINAL_FILENAME");
    File literalRoot = filesDir.getAbsoluteFile();
    File canonicalRoot = literalRoot.getCanonicalFile();
    for (String kind : new String[]{"files", "recordings"}) {
      String relative = kind + "/accounts/" + encodedOwner + "/" + filename;
      File literalExpected = new File(literalRoot, relative);
      // Do NOT canonicalize this expected descendant. That would bless owner/
      // file symlinks. Only the Context-provided root is canonicalized.
      File canonicalExpected = new File(canonicalRoot, relative);
      if (!(input.getPath().equals(literalExpected.getPath()) || input.getPath().equals(canonicalExpected.getPath()))) continue;
      if (!input.getCanonicalFile().equals(canonicalExpected))
        throw new IllegalArgumentException("ORIGINAL_DESCENDANT_ALIAS");
      if (!canonicalExpected.isFile() || canonicalExpected.length() < 1 || canonicalExpected.length() > 2L * 1024 * 1024 * 1024)
        throw new IllegalArgumentException("ORIGINAL_FILE_STATE");
      return canonicalExpected;
    }
    throw new IllegalArgumentException("ORIGINAL_PATH_SCOPE");
  }
}
