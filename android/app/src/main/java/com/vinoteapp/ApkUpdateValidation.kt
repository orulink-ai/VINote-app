package com.vinoteapp

internal fun validApkUpdate(
  newPackage: String?, newVersion: Long, newSigners: Set<String>,
  installedPackage: String, installedVersion: Long, installedSigners: Set<String>,
): Boolean = newPackage == installedPackage && newVersion > installedVersion &&
  installedSigners.isNotEmpty() && newSigners == installedSigners
