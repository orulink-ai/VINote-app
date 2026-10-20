package com.vinoteapp

import android.content.Context
import android.net.Uri
import java.io.File

/** Only this installation's account-bound originals; never remote/content URIs. */
internal fun originalMedia(context: Context, uri: String, owner: String): File {
  require(owner.isNotBlank() && owner.length <= 200)
  val parsed = Uri.parse(uri)
  require(parsed.scheme == "file" && parsed.authority.isNullOrEmpty())
  require(uri.startsWith("file:///") && parsed.query == null && parsed.fragment == null)
  // RNFS URIs are file:// followed by the literal sandbox path (owner is already
  // encodeURIComponent encoded). Do not decode an owner's literal % sequence.
  val source = File(uri.removePrefix("file://")).absoluteFile
  require(source.path == source.canonicalPath && source.isFile && source.length() in 1..(2L * 1024 * 1024 * 1024))
  val roots = listOf("files", "recordings").map { File(context.filesDir, "$it/accounts/${Uri.encode(owner)}") }
  require(roots.any { it.path == it.canonicalPath && source.parentFile == it })
  require(Regex("[a-zA-Z0-9-]+\\.[a-z0-9]{1,8}").matches(source.name))
  require(OriginalFilePolicy.exportable(source.extension)) { "App 仅支持导出音频和文档，历史视频未更改" }
  return source
}
