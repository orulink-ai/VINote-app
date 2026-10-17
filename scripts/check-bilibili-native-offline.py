"""Compile actual Android Bili bridge/downloader; execute shared policy, without network/device/Gradle."""
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
CACHE = Path(os.environ.get('GRADLE_USER_HOME', str(Path.home() / '.gradle'))) / 'caches'
MODULES = CACHE / 'modules-2/files-2.1'


def jar(group, name, version):
    return next((MODULES / group / name / version).glob('*/*.jar'))


stdlib = jar('org.jetbrains.kotlin', 'kotlin-stdlib', '2.2.10')
annotations = jar('org.jetbrains', 'annotations', '23.0.0')
compiler = [jar('org.jetbrains.kotlin', 'kotlin-compiler-embeddable', '2.2.10'), stdlib,
            jar('org.jetbrains.kotlin', 'kotlin-script-runtime', '2.2.10'),
            jar('org.jetbrains.kotlin', 'kotlin-reflect', '2.2.10'), annotations,
            jar('org.jetbrains.kotlinx', 'kotlinx-coroutines-core-jvm', '1.8.1')]
android = Path(os.environ['ANDROID_HOME']) / 'platforms/android-36/android.jar'
react = next(CACHE.glob('*/transforms/*/transformed/react-android-0.87.1-debug/jars/classes.jar'))
okhttp = jar('com.squareup.okhttp3', 'okhttp', '4.9.2')
okio = jar('com.squareup.okio', 'okio', '2.9.0')
deps = [stdlib, annotations, android, react, okhttp, okio]
with tempfile.TemporaryDirectory(prefix='vinote-bili-native-') as folder:
    source = ROOT / 'android/app/src/main/java/com/vinoteapp'
    subprocess.run(['java', '-Xmx256m', '-cp', os.pathsep.join(map(str, compiler)),
                    'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler', '-no-stdlib', '-no-reflect', '-jvm-target', '17',
                    '-classpath', os.pathsep.join(map(str, deps)), '-d', folder,
                    *map(str, [source / 'BilibiliDownloadPolicy.kt', source / 'BilibiliAudioDownloader.kt',
                               source / 'MeetingFiles.kt', ROOT / 'android/bilibili-download-tests/BilibiliDownloadPolicyTest.kt',
                               ROOT / 'android/bilibili-download-tests/BilibiliNativeHttpTest.kt'])], check=True, timeout=90)
    for test in ['BilibiliDownloadPolicyTestKt', 'BilibiliNativeHttpTestKt']:
        subprocess.run(['java', '-Xmx96m', '-cp', os.pathsep.join(map(str, [folder, stdlib, okhttp, okio, android])),
                        'com.vinoteapp.' + test], check=True, timeout=20)
