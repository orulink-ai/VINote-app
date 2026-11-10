import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { Platform } from 'react-native'
import { AndroidUpdateInstall } from '../src/components/AndroidUpdateInstall'
import { PrimaryButton } from '../src/components/PrimaryButton'
import { Text } from '../src/components/AppText'
import { checkAndroidRelease } from '../src/lib/androidRelease'
import { checkInstallableAndroidRelease } from '../src/lib/installableAndroidRelease'
import { downloadApkUpdate } from '../src/lib/downloadApkUpdate'
import { installApkUpdate, openApkInstallSettings } from '../src/lib/installApkUpdate'

jest.mock('../src/lib/androidRelease', () => ({ checkAndroidRelease: jest.fn() }))
jest.mock('../src/lib/installableAndroidRelease', () => ({ checkInstallableAndroidRelease: jest.fn() }))
jest.mock('../src/lib/downloadApkUpdate', () => ({ downloadApkUpdate: jest.fn() }))
jest.mock('../src/lib/installApkUpdate', () => ({ installApkUpdate: jest.fn(), openApkInstallSettings: jest.fn(), hasOfficialUpdateInstaller: () => true }))

test('checks, downloads, and requests permission without claiming the update was installed', async () => {
  jest.replaceProperty(Platform, 'OS', 'android')
  const release = { version: '0.2.0', notes: '修复', pageUrl: 'https://example.test/release', apkUrl: 'https://example.test/app.apk' }
  jest.mocked(checkAndroidRelease).mockResolvedValue(release)
  jest.mocked(checkInstallableAndroidRelease).mockResolvedValue({ ...release, asset: { url: release.apkUrl, bytes: 5, sha256: 'a'.repeat(64) } })
  jest.mocked(downloadApkUpdate).mockReturnValue({ promise: Promise.resolve('/cache/update.apk'), cancel: jest.fn() })
  jest.mocked(installApkUpdate).mockResolvedValue('permission_required')
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<AndroidUpdateInstall />) })
  const press = async (title: string) => { await act(async () => view.root.findAllByType(PrimaryButton).find(node => node.props.title === title)!.props.onPress()) }
  await press('检查更新')
  await press('下载更新')
  await press('安装更新')
  expect(view.root.findAllByType(Text).map(node => node.props.children).flat().join(' ')).toContain('请先允许 VINote 安装应用')
  expect(openApkInstallSettings).not.toHaveBeenCalled()
  expect(view.root.findAllByType(PrimaryButton).map(node => node.props.title)).toContain('打开安装权限设置')
  await act(async () => view.unmount())
  jest.restoreAllMocks()
})

test('two rapid download taps start only one download and leave it cancellable', async () => {
  jest.replaceProperty(Platform, 'OS', 'android')
  const release = { version: '0.2.0', notes: '', pageUrl: 'https://example.test/release', apkUrl: 'https://example.test/app.apk' }
  jest.mocked(checkAndroidRelease).mockResolvedValue(release)
  jest.mocked(checkInstallableAndroidRelease).mockResolvedValue({ ...release, asset: { url: release.apkUrl, bytes: 5, sha256: 'a'.repeat(64) } })
  const cancel = jest.fn()
  jest.mocked(downloadApkUpdate).mockReset().mockReturnValue({ promise: new Promise(() => {}), cancel })
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<AndroidUpdateInstall />) })
  await act(async () => view.root.findAllByType(PrimaryButton).find(node => node.props.title === '检查更新')!.props.onPress())
  const button = view.root.findAllByType(PrimaryButton).find(node => node.props.title === '下载更新')!
  await act(async () => { button.props.onPress(); button.props.onPress() })
  expect(downloadApkUpdate).toHaveBeenCalledTimes(1)
  await act(async () => view.root.findAllByType(PrimaryButton).find(node => node.props.title === '取消下载')!.props.onPress())
  expect(cancel).toHaveBeenCalled()
  await act(async () => view.unmount())
  jest.restoreAllMocks()
})
