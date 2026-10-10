const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

test('Android share provider includes recordings without exposing all private app files', () => {
  const paths = readFileSync(join(__dirname, '../android/app/src/main/res/xml/share_download_paths.xml'), 'utf8')
  assert.match(paths, /<files-path\s+name="recording_audio"\s+path="recordings\/accounts\/"\s*\/>/)
  assert.doesNotMatch(paths, /<files-path[^>]*path="(?:\/|\.|)"/)
  assert.doesNotMatch(paths, /<root-path/)
  assert.ok(paths.includes('<cache-path name="rnshare2" path="/" />'))
  assert.ok(paths.includes('<external-path name="rnshare1" path="Download/" />'))
})
