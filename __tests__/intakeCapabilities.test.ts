import { allowsBilibili, isVideoUrlAllowed } from '../src/lib/intakeCapabilities'
const restricted = { video_url: true, video_url_platforms: ['bilibili'] }
test.each(['https://www.bilibili.com/video/BVsynthetic', 'https://m.bilibili.com/video/BVsynthetic', 'https://b23.tv/synthetic'])('explicit Bilibili allowlist permits %s', url => {
  expect(isVideoUrlAllowed(url, restricted)).toBe(true)
})
test.each(['https://youtu.be/synthetic', 'https://www.youtube.com/watch?v=synthetic', 'https://v.douyin.com/synthetic', 'https://media.example/demo.mp4'])('Bilibili allowlist does not authorize other media %s', url => {
  expect(isVideoUrlAllowed(url, restricted)).toBe(false)
})
test('explicit empty list narrows even a true legacy flag; absent list preserves old device contract', () => {
  expect(isVideoUrlAllowed('https://youtu.be/synthetic', { video_url: true })).toBe(true)
  expect(isVideoUrlAllowed('https://b23.tv/synthetic', { video_url: true, video_url_platforms: [] })).toBe(false)
  expect(isVideoUrlAllowed('https://b23.tv/synthetic', { video_url: false })).toBe(false)
  expect(isVideoUrlAllowed('https://python.org/about', restricted)).toBe(true)
})

 test('video_url false overrides an explicit Bilibili platform declaration', () => {
  const disabled = { video_url: false, video_url_platforms: ['bilibili'] }
  expect(allowsBilibili(disabled)).toBe(false)
  expect(isVideoUrlAllowed('https://b23.tv/synthetic', disabled)).toBe(false)
  expect(isVideoUrlAllowed('https://www.bilibili.com/video/BVsynthetic', disabled)).toBe(false)
})
