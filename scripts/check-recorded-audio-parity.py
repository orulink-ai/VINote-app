"""Check the shared PCM fixture against the actual desktop Python planner.
Read-only import; no providers, credentials, device, Gradle or dependency downloads.
All temporary WAVs stay under this App repo's ignored artifacts directory.
"""
import json
from pathlib import Path
import runpy
import struct
import sys
import tempfile
import wave

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
planner = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT.parent / 'app/services/adaptive_asr_policy.py'
namespace = runpy.run_path(str(planner))
fixture = json.loads((ROOT / '__tests__/fixtures/recorded-audio-boundaries.json').read_text(encoding='utf-8'))
scratch = ROOT / 'artifacts/planner-parity'
scratch.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(dir=scratch) as directory:
    for case in fixture['cases']:
        path = Path(directory) / 'synthetic.wav'
        with wave.open(str(path), 'wb') as output:
            output.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
            for start in range(0, case['totalFrames'], 320):
                samples = []
                for sample in range(start, min(start + 320, case['totalFrames'])):
                    amplitude = case['amplitude']
                    for lo, hi, value in case['overrides']:
                        if lo <= sample < hi:
                            amplitude = value
                    samples.append(amplitude)
                output.writeframesraw(struct.pack('<' + 'h' * len(samples), *samples))
        intervals = namespace['plan_intervals'](path, namespace['RecordedAudioPolicy'](case['budgetBytes']), start_frame=case['firstFrame'])
        assert [list(interval) for interval in intervals] == case['expectedIntervals'], case['name']
        print('PASS', case['name'], intervals)
print(f"RESULT {len(fixture['cases'])} actual Python planner fixture cases passed")
