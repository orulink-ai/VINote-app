const mockInstall = jest.fn()
const mockSettings = jest.fn()
jest.mock('react-native', () => ({ NativeModules: { ApkUpdate: { installVerifiedUpdate: (...args: unknown[]) => mockInstall(...args), openInstallPermissionSettings: (...args: unknown[]) => mockSettings(...args) } } }))
import { canInstallOfficialUpdate, installApkUpdate, openApkInstallSettings } from '../src/lib/installApkUpdate'

beforeEach(() => { mockInstall.mockReset(); mockSettings.mockReset() })
test('official OTA requires the exact production package identity', () => {
  expect(canInstallOfficialUpdate('com.vinoteapp')).toBe(true)
  expect(canInstallOfficialUpdate('com.vinoteapp.dev')).toBe(false)
  expect(canInstallOfficialUpdate(undefined)).toBe(false)
})
test('reports an installer opening without claiming installation succeeded', async () => {
  mockInstall.mockResolvedValue('installer_opened')
  await expect(installApkUpdate('/cache/vinote-updates/update.apk')).resolves.toBe('installer_opened')
})
test('returns a permission request without opening system settings automatically', async () => {
  mockInstall.mockResolvedValue('permission_required')
  await expect(installApkUpdate('/cache/vinote-updates/update.apk')).resolves.toBe('permission_required')
  expect(mockSettings).not.toHaveBeenCalled()
})
test('rejects unexpected native responses and opens settings only on explicit request', async () => {
  mockInstall.mockResolvedValue('installed')
  await expect(installApkUpdate('/cache/vinote-updates/update.apk')).rejects.toThrow()
  mockSettings.mockResolvedValue(true)
  await expect(openApkInstallSettings()).resolves.toBe(true)
})
