const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const os = require('node:os')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const models = [
  { name: 'segmentation.onnx', hash: '220ad67ca923bef2fa91f2390c786097bf305bceb5e261d4af67b38e938e1079', asset: '197666131', archive: 'sherpa-onnx-pyannote-segmentation-3-0/model.onnx' },
  { name: 'embedding.onnx', hash: '1a331345f04805badbb495c775a6ddffcdd1a732567d5ec8b3d5749e3c7a5e4b', asset: '198893098' },
]
async function hash(file) {
  if (!fs.existsSync(file)) return ''
  const digest = crypto.createHash('sha256')
  for await (const chunk of fs.createReadStream(file)) digest.update(chunk)
  return digest.digest('hex')
}
function command(binary, args) {
  const result = spawnSync(binary, args, { stdio: 'inherit' })
  if (result.status !== 0 || result.error) throw result.error || new Error(`${binary} failed`)
}
function cleanTemp(temp) {
  if (!path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(temp).startsWith('vinote-speaker-')) throw new Error('Invalid temporary directory')
  fs.rmSync(temp, { recursive: true, force: true })
}
async function prepare(ios = false) {
  const destination = path.join(root, 'android/app/src/main/assets/speaker')
  fs.mkdirSync(destination, { recursive: true })
  for (const model of models) {
    const target = path.join(destination, model.name)
    if (await hash(target) === model.hash) continue
    const local = path.resolve(root, '../data/models/diarization', model.name)
    if (await hash(local) === model.hash) fs.copyFileSync(local, target)
    else {
      const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'vinote-speaker-'))
      try {
        const download = path.join(temp, model.archive ? 'model.tar.bz2' : model.name)
        command('curl', ['--fail', '--location', '--retry', '2', '--max-time', '600', '-H', 'Accept: application/octet-stream', '-o', download, `https://api.github.com/repos/k2-fsa/sherpa-onnx/releases/assets/${model.asset}`])
        if (model.archive) command('tar', ['-xjf', download, '-C', temp, model.archive])
        const extracted = model.archive ? path.join(temp, model.archive) : download
        if (await hash(extracted) !== model.hash) throw new Error(`Invalid model checksum: ${model.name}`)
        fs.copyFileSync(extracted, target)
      } finally {
        cleanTemp(temp)
      }
    }
    if (await hash(target) !== model.hash) throw new Error(`Invalid model checksum: ${model.name}`)
  }
  if (ios) {
    const modelDirectory = path.join(root, 'ios/speaker-models')
    fs.mkdirSync(modelDirectory, { recursive: true })
    for (const model of models) {
      const target = path.join(modelDirectory, model.name)
      if (await hash(target) !== model.hash) fs.copyFileSync(path.join(destination, model.name), target)
    }
    const runtime = path.join(root, 'ios/sherpa-runtime')
    const digest = 'ce3fa84233ac35be550b50757b32445949bbc1c8e3890877f0880ce72825a017'
    const receipt = path.join(runtime, 'verified-archive.sha256')
    const complete = ['sherpa-onnx.xcframework', 'onnxruntime.xcframework'].every(name => fs.existsSync(path.join(runtime, name, 'Info.plist')))
    if (!complete || !fs.existsSync(receipt) || fs.readFileSync(receipt, 'utf8').trim() !== digest) {
      const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'vinote-speaker-'))
      try {
        const archive = path.join(temp, 'ios.tar.bz2')
        const local = path.resolve(root, '../data/sherpa-ios.tar.bz2')
        if (await hash(local) === digest) fs.copyFileSync(local, archive)
        else command('curl', ['--fail', '--location', '--retry', '2', '--max-time', '600', '-H', 'Accept: application/octet-stream', '-o', archive, 'https://api.github.com/repos/k2-fsa/sherpa-onnx/releases/assets/387589615'])
        if (await hash(archive) !== digest) throw new Error('Invalid iOS runtime checksum')
        fs.mkdirSync(runtime, { recursive: true })
        command('tar', ['-xjf', archive, '-C', runtime, '--strip-components=2', './build-ios-no-tts/sherpa-onnx.xcframework'])
        command('tar', ['-xjf', archive, '-C', runtime, '--strip-components=4', './build-ios-no-tts/ios-onnxruntime/1.17.1/onnxruntime.xcframework'])
        fs.writeFileSync(receipt, digest + '\n')
      } finally { cleanTemp(temp) }
    }
  }
  console.log('Speaker models ready (verified SHA-256)')
}
module.exports = { prepare }
if (require.main === module) prepare(process.argv.includes('--ios')).catch(error => { console.error(error.message); process.exitCode = 1 })
