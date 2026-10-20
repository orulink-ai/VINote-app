package com.vinoteapp;

import java.io.File;
import java.nio.file.*;

/** Real filesystem links, no Android/React mocks and no fallback that skips links. */
public class OriginalPathPolicyTest {
  private static int rejected;
  private static void reject(File root, Path source, String owner) throws Exception {
    try { OriginalPathPolicy.requireFile(root, source.toFile(), owner); throw new AssertionError("Unexpected acceptance"); }
    catch (IllegalArgumentException expected) { rejected++; }
  }
  public static void main(String[] args) throws Exception {
    Path run = Files.createTempDirectory(Paths.get(args[0]).toAbsolutePath(), "original-scope-");
    Path canonical = Files.createDirectories(run.resolve("canonical/files"));
    Path alias = run.resolve("trusted-files-alias");
    Files.createSymbolicLink(alias, canonical.toAbsolutePath());
    File trusted = alias.toFile();
    Path account = Files.createDirectories(canonical.resolve("recordings/accounts/alice"));
    String filename = "meeting-001.m4a";
    Path original = account.resolve(filename); Files.write(original, new byte[]{1,2,3});
    File aliased = alias.resolve("recordings/accounts/alice/" + filename).toFile();
    if (aliased.getPath().equals(aliased.getCanonicalPath())) throw new AssertionError("Alias fixture did not reproduce path inequality");
    if (!aliased.isFile() || aliased.length() != 3) throw new AssertionError();
    // The production check at eace563:OriginalMedia.kt:16 rejects this valid file.
    if (!(aliased.getPath().equals(aliased.getCanonicalPath()) && aliased.isFile() && aliased.length() > 0))
      System.out.println("Baseline reproduced: trusted-root alias fails old canonical equality while isFile/size pass");
    if (!OriginalPathPolicy.requireFile(trusted, aliased, "alice").equals(original.toFile())) throw new AssertionError();
    OriginalPathPolicy.requireFile(trusted, original.toFile(), "alice");
    Path document = Files.createDirectories(canonical.resolve("files/accounts/alice")).resolve("document.pdf");
    Files.write(document, new byte[]{4});
    OriginalPathPolicy.requireFile(trusted, document.toFile(), "alice");
    Path encoded = Files.createDirectories(canonical.resolve("files/accounts/a%2Fb")).resolve("record.m4a");
    Files.write(encoded, new byte[]{5});
    OriginalPathPolicy.requireFile(trusted, encoded.toFile(), "a%2Fb");
    reject(trusted, original, "bob");
    reject(trusted, canonical.resolve("recordings/accounts/alice/../alice/" + filename), "alice");
    reject(trusted, original, "..");
    reject(trusted, original, "alice/../alice");
    Path outside = Files.createDirectories(run.resolve("outside"));
    Path outsideAudio = outside.resolve("outside.m4a"); Files.write(outsideAudio, new byte[]{6});
    reject(trusted, outsideAudio, "alice");
    Path ownerLink = canonical.resolve("recordings/accounts/bob");
    Files.createSymbolicLink(ownerLink, account);
    reject(trusted, ownerLink.resolve(filename), "bob");
    Path fileLink = account.resolve("linked.m4a"); Files.createSymbolicLink(fileLink, outsideAudio);
    reject(trusted, fileLink, "alice");
    Path insideLink = account.resolve("internal.m4a"); Files.createSymbolicLink(insideLink, original);
    reject(trusted, insideLink, "alice");
    Path kindRoot = Files.createDirectories(run.resolve("kind-root"));
    Files.createSymbolicLink(kindRoot.resolve("recordings"), canonical.resolve("recordings"));
    reject(kindRoot.toFile(), kindRoot.resolve("recordings/accounts/alice/" + filename), "alice");
    Path secondAlias = run.resolve("untrusted-alias"); Files.createSymbolicLink(secondAlias, canonical);
    reject(trusted, secondAlias.resolve("recordings/accounts/alice/" + filename), "alice");
    Path empty = account.resolve("empty.m4a"); Files.createFile(empty);
    reject(trusted, empty, "alice");
    reject(trusted, account.resolve("missing.m4a"), "alice");
    reject(trusted, account, "alice");
    if (rejected != 13 || Files.size(original) != 3) throw new AssertionError();
    System.out.println("OriginalPathPolicy: 4 valid original/document/encoded-owner cases and 13 rejection cases passed; real symlinks, original unchanged");
  }
}
