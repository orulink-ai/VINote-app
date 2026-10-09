const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { selectDeployment } = require('./select-deployment.cjs')

const modes = {
  'test:debug': { channel: 'test', appId: 'com.vinoteapp.test', needsMetro: true },
  'test:apk': { channel: 'test', appId: 'com.vinoteapp.test', needsMetro: false, task: 'assembleDebug', standalone: true, artifact: 'vinote-test.apk' },
  'vinote:debug': { channel: 'public', appId: 'com.vinoteapp.dev', needsMetro: true },
  'vinote:apk': { channel: 'public', appId: 'com.vinoteapp', needsMetro: false, task: 'assembleRelease', artifact: 'vinote.apk' },
  bundle: { channel: 'public', appId: 'com.vinoteapp', needsMetro: false, task: 'bundleRelease' },
}
const aliases = { standalone: 'test:apk', release: 'vinote:apk' }

function planAndroidCommand(mode) {
  const selected = modes[aliases[mode] || mode]
  if (!selected) throw new Error('Usage: node scripts/android-build.cjs test:debug|test:apk|vinote:debug|vinote:apk|bundle')
  return {
    ...selected,
    args: selected.needsMetro
      ? ['-PvinoteChannel=' + selected.channel]
      : [selected.task, ...(selected.standalone ? ['-PvinoteStandalone=true'] : []), '-PvinoteChannel=' + selected.channel],
  }
}

function run(mode, extraArgs = []) {
  const plan = planAndroidCommand(mode)
  selectDeployment(plan.channel)
  let result
  if (plan.needsMetro) {
    const cli = path.join(__dirname, '../node_modules/@react-native-community/cli/build/bin.js')
    result = spawnSync(process.execPath, [cli, 'run-android', '--mode', 'debug', '--appId', plan.appId,
      '--extra-params', plan.args.join(' '), ...extraArgs], { cwd: path.join(__dirname, '..'), stdio: 'inherit' })
  } else {
    const windows = process.platform === 'win32'
    result = spawnSync(windows ? 'cmd.exe' : './gradlew', windows
      ? ['/d', '/c', 'gradlew.bat', ...plan.args, ...extraArgs]
      : [...plan.args, ...extraArgs], { cwd: path.join(__dirname, '../android'), stdio: 'inherit' })
  }
  if (result.error) throw result.error
  if (result.status === 0 && plan.artifact) {
    const root = path.join(__dirname, '..')
    const variant = plan.channel === 'test' ? 'debug' : 'release'
    const source = path.join(root, 'android/app/build/outputs/apk', variant, `app-${variant}.apk`)
    const destination = path.join(root, 'artifacts/android', plan.artifact)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.copyFileSync(source, destination)
    console.log('APK: ' + destination)
  }
  process.exitCode = result.status ?? 1
}

module.exports = { planAndroidCommand }
if (require.main === module) run(process.argv[2], process.argv.slice(3))
