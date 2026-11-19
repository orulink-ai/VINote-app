const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')

test('Android package versions agree and iOS retains its separately released version', () => {
  const pkg = JSON.parse(read('package.json'))
  const lock = JSON.parse(read('package-lock.json'))
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/)
  assert.equal(lock.version, pkg.version)
  assert.equal(lock.packages[''].version, pkg.version)
  const android = read('android/app/build.gradle')
  assert.equal(android.match(/versionName\s+"([^"]+)"/)?.[1], pkg.version)
  assert.ok(Number(android.match(/versionCode\s+(\d+)/)?.[1]) >= 16)
  assert.doesNotMatch(read('android/app/src/main/AndroidManifest.xml'), /android:version(?:Name|Code)/)
  const ios = read('ios/VINoteApp.xcodeproj/project.pbxproj')
  const iosVersions = [...ios.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map(m => m[1])
  const iosBuilds = [...ios.matchAll(/CURRENT_PROJECT_VERSION = ([^;]+);/g)].map(m => m[1])
  assert.equal(iosVersions.length, 2)
  assert.match(iosVersions[0], /^\d+\.\d+\.\d+$/)
  assert.equal(iosVersions[0], iosVersions[1])
  assert.equal(iosBuilds.length, 2)
  assert.ok(Number(iosBuilds[0]) >= 5)
  assert.equal(iosBuilds[0], iosBuilds[1])
  const plist = read('ios/VINoteApp/Info.plist')
  assert.ok(plist.includes('$(MARKETING_VERSION)'))
  assert.ok(plist.includes('$(CURRENT_PROJECT_VERSION)'))
})

test('iOS release identity matches the registered VINote application', () => {
  const ios = read('ios/VINoteApp.xcodeproj/project.pbxproj')
  assert.ok(ios.includes('PRODUCT_BUNDLE_IDENTIFIER = com.orulink.vinote;'))
  assert.ok(ios.includes('DEVELOPMENT_TEAM = LP4D78XZ45;'))
  assert.ok(!ios.includes('org.reactjs.native.example.'))
})

test('declared iPad support includes the required home screen icon sizes', () => {
  const folder = path.join(__dirname, '..', 'ios/VINoteApp/Images.xcassets/AppIcon.appiconset')
  const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'Contents.json'), 'utf8'))
  for (const pixels of [152, 167]) {
    const icon = manifest.images.find(image => image.idiom === 'ipad' &&
      Number(image.size.split('x')[0]) * Number(image.scale.slice(0, -1)) === pixels)
    assert.ok(icon, 'Missing required iPad icon at ' + pixels + 'px')
    const png = fs.readFileSync(path.join(folder, icon.filename))
    assert.equal(png.readUInt32BE(16), pixels)
    assert.equal(png.readUInt32BE(20), pixels)
  }
})

// RNShare links Photos APIs even when the app only uses its system share sheet.
test('iOS declares a nonempty photo-library purpose for the linked sharing SDK', () => {
  const plist = read('ios/VINoteApp/Info.plist')
  const purpose = plist.match(/<key>NSPhotoLibraryUsageDescription<\/key>\s*<string>([^<]+)<\/string>/)?.[1]
  assert.ok(purpose?.trim(), 'Apple ITMS-90683: missing photo-library purpose string')
})
