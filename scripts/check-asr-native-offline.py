"""Compile the actual ASR native module against cached RN/OkHttp/Android APIs; run pure policy checks.
No downloads, Gradle daemon or device. --local-ws additionally uses a loopback-only synthetic peer.
BuildConfig is a compile-only shim for the single generated field; this is not an APK build.
"""
import os
from pathlib import Path
import subprocess
import tempfile
import sys

ROOT = Path(__file__).resolve().parents[1]
CACHE = Path(os.environ.get("GRADLE_USER_HOME", str(Path.home() / ".gradle"))) / "caches"
MODULES = CACHE / "modules-2/files-2.1"


def jar(group, artifact, version):
    return next((MODULES / group / artifact / version).glob("*/*.jar"))


stdlib = jar("org.jetbrains.kotlin", "kotlin-stdlib", "2.2.10")
annotations = jar("org.jetbrains", "annotations", "23.0.0")
compiler_cp = [
    jar("org.jetbrains.kotlin", "kotlin-compiler-embeddable", "2.2.10"), stdlib,
    jar("org.jetbrains.kotlin", "kotlin-script-runtime", "2.2.10"),
    jar("org.jetbrains.kotlin", "kotlin-reflect", "2.2.10"), annotations,
    jar("org.jetbrains.kotlinx", "kotlinx-coroutines-core-jvm", "1.8.1"),
]
sdk = Path(os.environ.get("ANDROID_HOME", os.environ.get("ANDROID_SDK_ROOT", "")))
android = sdk / "platforms/android-36/android.jar"
react = next(CACHE.glob("*/transforms/*/transformed/react-android-0.87.1-debug/jars/classes.jar"))
deps = [stdlib, annotations, android, react,
        jar("com.squareup.okhttp3", "okhttp", "4.9.2"),
        jar("com.squareup.okio", "okio", "2.9.0")]
with tempfile.TemporaryDirectory(prefix="vinote-asr-native-") as tmp:
    temp = Path(tmp)
    fixture = temp / "js-vla2.tsv"
    subprocess.run(["node", str(ROOT / "scripts/asr-vla2-fixture.cjs"), str(fixture)], check=True, timeout=20)
    stub = temp / "BuildConfig.java"
    stub.write_text('package com.vinoteapp; public final class BuildConfig { public static final String VINOTE_ASR_ORIGIN = "https://api.orulink.ai"; }', encoding="utf-8")
    subprocess.run(["javac", "-J-Xmx256m", "-d", tmp, str(stub)], check=True, timeout=30)
    source = ROOT / "android/app/src/main/java/com/vinoteapp"
    subprocess.run(["java", "-Xmx512m", "-cp", os.pathsep.join(map(str, compiler_cp)),
                    "org.jetbrains.kotlin.cli.jvm.K2JVMCompiler", "-no-stdlib", "-no-reflect",
                    "-jvm-target", "17", "-classpath", os.pathsep.join(map(str, deps + [temp])),
                    "-d", tmp, str(source / "ASRTransportPolicy.kt"), str(source / "ASRSocketCore.kt"), str(source / "VINoteASRTransport.kt"),
                    str(ROOT / "android/asr-transport-tests/ASRLocalWebSocketTest.kt"),
                    str(ROOT / "android/asr-transport-tests/ASRTransportPolicyTest.kt")], check=True, timeout=60)
    runtime = os.pathsep.join(map(str, [temp, stdlib, deps[-2], deps[-1]]))
    subprocess.run(["java", "-Xmx128m", "-cp", runtime,
                    "com.vinoteapp.ASRTransportPolicyTestKt", str(fixture)], check=True, timeout=20)
    if "--local-ws" in sys.argv:
        from asr_local_ws_server import LocalASRPeer
        with LocalASRPeer() as peer:
            subprocess.run(["java", "-Xmx256m", "-cp", runtime,
                            "com.vinoteapp.ASRLocalWebSocketTestKt", peer.url, str(fixture)], check=True, timeout=30)
