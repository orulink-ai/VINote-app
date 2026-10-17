"""Compile/run the C core used by iOS. No Apple/React/Sherpa execution or download."""
from pathlib import Path
import os
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix="vinote-speaker-range-") as temporary:
    executable = Path(temporary) / ("range-test.exe" if os.name == "nt" else "range-test")
    subprocess.run([os.environ.get("CC", "gcc"), "-std=c11", "-D_POSIX_C_SOURCE=200809L", "-Wall", "-Wextra", "-Werror",
                    str(root / "ios/speaker-range-tests/SpeakerAudioRangeTest.c"),
                    "-lm", "-o", str(executable)], check=True, timeout=30)
    subprocess.run([str(executable)], check=True, timeout=10)
