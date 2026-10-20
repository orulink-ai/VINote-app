// Existing video metadata remains readable; these gates only restrict new actions.
export function isAppVideo(file: { extension?: string; name?: string; category?: string }) {
  const extension = (file.extension || file.name?.split('.').pop() || '').toLowerCase()
  return file.category === 'video' || ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'].includes(extension)
}
export function appExportSupported(extension: string) {
  return ['m4a', 'mp3', 'wav', 'aac', 'flac', 'ogg', 'opus', 'pdf', 'docx', 'md', 'txt', 'srt', 'vtt', 'json'].includes(extension)
}
