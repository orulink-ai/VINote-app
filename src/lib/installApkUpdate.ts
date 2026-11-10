import { NativeModules } from 'react-native'

export const canInstallOfficialUpdate = (applicationId: unknown) => applicationId === 'com.vinoteapp'
export const hasOfficialUpdateInstaller = () => canInstallOfficialUpdate(NativeModules.ApkUpdate?.applicationId)

export async function installApkUpdate(path: string): Promise<'installer_opened' | 'permission_required'> {
  const installer = NativeModules.ApkUpdate
  if (!installer?.installVerifiedUpdate) throw new Error('当前安装包不支持应用内安装更新')
  const state: unknown = await installer.installVerifiedUpdate(path)
  if (state !== 'installer_opened' && state !== 'permission_required') throw new Error('无法确认系统安装器状态')
  return state
}

export async function openApkInstallSettings(): Promise<boolean> {
  const installer = NativeModules.ApkUpdate
  if (!installer?.openInstallPermissionSettings) throw new Error('当前安装包不支持打开安装权限设置')
  return (await installer.openInstallPermissionSettings()) === true
}
