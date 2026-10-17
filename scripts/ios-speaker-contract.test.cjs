const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.join(__dirname, '..')
test('iOS source exports the JS window signature and uses the tested bounded PCM core (source wiring only)', () => {
  const source = fs.readFileSync(path.join(root, 'ios/MeetingSpeakers.m'), 'utf8')
  assert.match(source, /RCT_REMAP_METHOD\(analyzeWindow,\s*analyzeWindow:\(NSString \*\)uri\s+start:\(double\)start\s+end:\(double\)end\s+jobId:\(NSString \*\)jobId/)
  assert.match(source, /VINoteSpeakerMakeRange\(/)
  assert.match(source, /VINoteSpeakerReadRange\(/)
})
test('the Pod includes the actual shared range header in its sources (source wiring only)', () => {
  assert.match(fs.readFileSync(path.join(root, 'ios/VINoteSpeakers.podspec'), 'utf8'), /s\.source_files\s*=.*SpeakerAudioRange\.h/)
})
