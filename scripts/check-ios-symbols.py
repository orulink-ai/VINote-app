"""Verify that every archived iOS executable has matching debug symbols."""
import argparse
from pathlib import Path
import plistlib
import re
import subprocess


def uuids(path):
    result = subprocess.run(
        ["xcrun", "dwarfdump", "--uuid", str(path)],
        check=True, capture_output=True, text=True,
    )
    return set(re.findall(r"UUID: ([A-Fa-f0-9-]+) \(([^)]+)\)", result.stdout))


def verify_archive(archive):
    applications = list((archive / "Products/Applications").glob("*.app"))
    if len(applications) != 1:
        raise ValueError("Expected exactly one archived iOS application")
    app = applications[0]
    with (app / "Info.plist").open("rb") as handle:
        executable = plistlib.load(handle)["CFBundleExecutable"]
    binaries = [app / executable]
    for framework in (app / "Frameworks").glob("*.framework"):
        with (framework / "Info.plist").open("rb") as handle:
            name = plistlib.load(handle)["CFBundleExecutable"]
        binaries.append(framework / name)

    symbols = set()
    for dwarf in (archive / "dSYMs").glob("*.dSYM/Contents/Resources/DWARF/*"):
        if dwarf.is_file():
            symbols.update(uuids(dwarf))
    missing = []
    for binary in binaries:
        identifiers = uuids(binary)
        if not identifiers or not identifiers.issubset(symbols):
            missing.append(binary.name)
    if missing:
        raise ValueError("Missing matching dSYM UUIDs for " + ", ".join(missing))
    print("Verified matching dSYM UUIDs for " + str(len(binaries)) + " archived executables")


def collect_hermes_symbols(archive, binary):
    frameworks = list((archive / "Products/Applications").glob("*.app/Frameworks/hermesvm.framework/hermesvm"))
    if len(frameworks) != 1 or uuids(binary) != uuids(frameworks[0]):
        raise ValueError("Hermes build and archive UUIDs must match before collecting symbols")
    output = archive / "dSYMs/hermesvm.framework.dSYM"
    if output.exists():
        raise ValueError("Hermes symbols already exist in this archive")
    subprocess.run(["xcrun", "dsymutil", str(binary), "-o", str(output)], check=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("--hermes-binary", type=Path)
    args = parser.parse_args()
    if args.hermes_binary:
        collect_hermes_symbols(args.archive, args.hermes_binary)
    verify_archive(args.archive)
