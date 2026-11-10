import FS from 'react-native-fs'
import { NativeModules } from 'react-native'
import { initialMeetingJob } from './meetingFileJobState'
import type { MeetingFilePolicy } from './meetingFilePolicy'
import type { MeetingFileCheckpoint } from './meetingFileWorkflow'

type Input = { uri: string; origin: string; owner: string; model: string; providerModel: string; id: string; policy: MeetingFilePolicy; guard: () => Promise<void> }

/** Normalize owned audio to the server's WAV format and bind the exact bytes before dispatch. */
export async function prepareMeetingFile(input: Input): Promise<{ wavUri: string; checkpoint: MeetingFileCheckpoint }> {
  const job = initialMeetingJob(input.id, input.model, input.owner)
  const path = input.uri.startsWith('file://') ? input.uri.slice(7) : ''
  const roots = ['recordings', 'files'].map(folder => `${FS.DocumentDirectoryPath}/${folder}/accounts/${encodeURIComponent(input.owner)}/`)
  if (!roots.some(root => path.startsWith(root) && /^[a-z0-9-]+\.[a-z0-9]{1,8}$/i.test(path.slice(root.length))) ||
      !/^https?:\/\/[a-z0-9.:-]+$/i.test(input.origin) || !input.providerModel.trim() ||
      !Number.isSafeInteger(input.policy.maxAudioBytes) || input.policy.maxAudioBytes <= 0 ||
      !Number.isSafeInteger(input.policy.maxAudioSeconds) || input.policy.maxAudioSeconds <= 0) throw new Error('会议音频来源或服务配置无效')
  const audio = NativeModules.MeetingAudio
  if (!audio?.toWav || !audio?.wavInfo) throw new Error('当前安装包无法准备会议音频')
  await input.guard()
  const source = await FS.stat(path)
  const originalSize = Number(source.size)
  if (!Number.isSafeInteger(originalSize) || originalSize <= 0) throw new Error('原音频无效')
  const originalSha256 = await FS.hash(path, 'sha256')
  if (!/^[a-f0-9]{64}$/i.test(originalSha256)) throw new Error('无法核验原音频')
  await input.guard()
  const recordingRoot = `${FS.DocumentDirectoryPath}/recordings/accounts/${encodeURIComponent(input.owner)}/`
  // Recording deletion is blocked during processing; generic note files do not
  // yet have the same lifetime guard and continue using a separate WAV cache.
  if (input.policy.supportsM4a && path.startsWith(recordingRoot) && /\.m4a$/i.test(path) && typeof audio.m4aInfo === 'function') {
    // A container with video or unknown tracks must never be uploaded whole.
    // Extract its audio through the existing WAV path instead.
    const duration: number | undefined = await audio.m4aInfo(input.uri).catch(() => undefined)
    if (duration !== undefined) {
      if (!Number.isFinite(duration) || duration <= 0 || duration > input.policy.maxAudioSeconds || originalSize > input.policy.maxAudioBytes) throw new Error('录音超过当前会议模型的可处理范围')
      if (Number((await FS.stat(path)).size) !== originalSize || await FS.hash(path, 'sha256') !== originalSha256) throw new Error('原音频在准备期间发生变化')
      await input.guard()
      return { wavUri: input.uri, checkpoint: { version: 1, job, binding: { origin: input.origin, providerModel: input.providerModel, originalSha256, wavSha256: originalSha256, wavBytes: originalSize, duration, audioFormat: 'm4a' } } }
    }
  }
  let wavPath = ''
  try {
    const wavUri: string = await audio.toWav(input.uri)
    const candidate = wavUri.startsWith('file://') ? wavUri.slice(7) : ''
    const cachePrefix = `${FS.CachesDirectoryPath}/asr-`
    if (!candidate.startsWith(cachePrefix) || !/^[a-f0-9-]+\.wav$/i.test(candidate.slice(cachePrefix.length))) throw new Error('音频缓存路径无效')
    wavPath = candidate
    await input.guard()
    const duration: number = await audio.wavInfo(wavUri)
    const wavBytes = Number((await FS.stat(wavPath)).size)
    if (!Number.isFinite(duration) || duration <= 0 || duration > input.policy.maxAudioSeconds ||
        !Number.isSafeInteger(wavBytes) || wavBytes <= 0 || wavBytes > input.policy.maxAudioBytes) throw new Error('录音超过当前会议模型的可处理范围')
    const wavSha256 = await FS.hash(wavPath, 'sha256')
    if (!/^[a-f0-9]{64}$/i.test(wavSha256) || Number((await FS.stat(path)).size) !== originalSize || await FS.hash(path, 'sha256') !== originalSha256) throw new Error('原音频在准备期间发生变化')
    await input.guard()
    return { wavUri, checkpoint: { version: 1, job, binding: { origin: input.origin, providerModel: input.providerModel, originalSha256, wavSha256, wavBytes, duration } } }
  } catch (error) {
    if (wavPath) await FS.unlink(wavPath).catch(() => {})
    throw error
  }
}
