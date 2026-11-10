package com.vinoteapp

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ApkUpdateValidationTest {
  @Test fun acceptsOnlyNewerSamePackageAndSigningCertificate() {
    assertTrue(validApkUpdate("com.vinoteapp", 10, setOf("a"), "com.vinoteapp", 9, setOf("a")))
    assertFalse(validApkUpdate("com.other", 10, setOf("a"), "com.vinoteapp", 9, setOf("a")))
    assertFalse(validApkUpdate("com.vinoteapp", 9, setOf("a"), "com.vinoteapp", 9, setOf("a")))
    assertFalse(validApkUpdate("com.vinoteapp", 10, setOf("b"), "com.vinoteapp", 9, setOf("a")))
    assertFalse(validApkUpdate("com.vinoteapp", 10, emptySet(), "com.vinoteapp", 9, emptySet()))
  }
}
