package com.vinoteapp;

import java.util.Locale;
import java.util.Arrays;
import java.util.List;

/** Old video files stay untouched; new imports and exports are audio/documents. */
final class OriginalFilePolicy {
  private static final List<String> VIDEO = Arrays.asList("mp4", "mov", "mkv", "webm", "avi", "m4v");
  private static final List<String> EXPORT = Arrays.asList("m4a", "mp3", "wav", "aac", "flac", "ogg", "opus", "pdf", "docx", "md", "txt", "srt", "vtt", "json");
  static boolean video(String name, String mime) {
    String extension = name.substring(name.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
    return VIDEO.contains(extension) || mime != null && mime.toLowerCase(Locale.ROOT).startsWith("video/");
  }
  static boolean exportable(String extension) { return EXPORT.contains(extension); }
}
