const { spawnSync } = require('node:child_process')
const path = require('node:path')
const { selectDeployment } = require('./select-deployment.cjs')
const tasks = { standalone: ['assembleDebug', '-PvinoteStandalone=true'], release: ['assembleRelease'], bundle: ['bundleRelease'] }
const args = tasks[process.argv[2]]
if (!args) throw new Error('Usage: node scripts/android-build.cjs standalone|release|bundle')
const channel = process.argv[2] === 'standalone' ? 'test' : 'public'
selectDeployment(channel)
args.push('-PvinoteChannel=' + channel)
const windows = process.platform === 'win32'
const result = spawnSync(windows ? 'cmd.exe' : './gradlew', windows ? ['/d', '/c', 'gradlew.bat', ...args] : args, { cwd: path.join(__dirname, '../android'), stdio: 'inherit' })
if (result.error) throw result.error
process.exit(result.status ?? 1)
