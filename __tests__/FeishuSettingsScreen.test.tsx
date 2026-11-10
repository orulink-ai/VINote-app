import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { FeishuSettingsScreen } from '../src/screens/FeishuSettingsScreen'
import { feishuApi } from '../src/lib/feishu'
import { PrimaryButton } from '../src/components/PrimaryButton'
import { SettingsCheckbox } from '../src/components/SettingsCheckbox'
import { ScreenHeader } from '../src/components/ScreenHeader'
import { FeishuDestinationPicker } from '../src/components/FeishuDestinationPicker'
import { Alert } from 'react-native'
import { readFeishuLocalPreferences, saveFeishuLocalPreferences } from '../src/lib/feishuLocalPreferences'
import { readAccountId } from '../src/lib/storage'
import { transitionIdentity } from '../src/lib/sessionIdentity'
jest.mock('../src/lib/feishu', () => ({ feishuApi: jest.fn() }))
jest.mock('../src/lib/storage', () => ({ readAccountId: jest.fn(async () => 'owner') }))
jest.mock('../src/lib/feishuLocalPreferences', () => ({ readFeishuLocalPreferences: jest.fn(async () => ({ notify_self: true, groups: [], destination_config: { kind: 'personal' }, permission_policy: 'private' })), saveFeishuLocalPreferences: jest.fn(async () => {}) }))
// These tests exercise preferences and connection state. Application credential
// management has separate requests and is not covered by this unit fixture.
jest.mock('../src/components/FeishuApplicationSetup', () => ({ FeishuApplicationSetup: () => null }))
afterEach(() => jest.clearAllMocks())

test('account change invalidates the old settings draft before it can be saved', async () => {
  jest.mocked(feishuApi).mockResolvedValueOnce({ configured: true, connected: true, expired: false, name: '测试', notify_self: true, groups: [], auto_publish: false }).mockResolvedValueOnce([])
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<FeishuSettingsScreen onBack={jest.fn()} />) })
  await act(async () => view.root.findAllByType(SettingsCheckbox)[0].props.onChange(false))
  await act(async () => transitionIdentity('other-owner'))
  expect(view.root.findAllByType(PrimaryButton).some(node => node.props.title === '保存设置')).toBe(false)
  expect(JSON.stringify(view.toJSON())).toContain('账号已切换')
  expect(saveFeishuLocalPreferences).not.toHaveBeenCalled()
  await act(async () => view.unmount())
})

test('does not present a default destination or disabled save bar while connection is loading', () => {
  jest.mocked(readAccountId).mockImplementationOnce(() => new Promise(() => {}))
  let view!: Renderer.ReactTestRenderer
  act(() => { view = Renderer.create(<FeishuSettingsScreen onBack={jest.fn()} />) })
  expect(view.root.findAllByType(FeishuDestinationPicker)).toHaveLength(0)
  expect(view.root.findAllByType(PrimaryButton).some(node => node.props.title === '保存设置')).toBe(false)
  act(() => view.unmount())
})

test('returning from the settings flow protects unsaved notification preferences', async () => {
  jest.mocked(feishuApi).mockResolvedValueOnce({ configured: true, connected: true, expired: false, name: '测试', notify_self: true, groups: [], auto_publish: false }).mockResolvedValueOnce([])
  const navigate = jest.fn()
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {})
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<FeishuSettingsScreen onBack={navigate} />) })
  await act(async () => view.root.findAllByType(SettingsCheckbox)[0].props.onChange(false))
  await act(async () => view.root.findByType(ScreenHeader).props.onBack())
  expect(navigate).not.toHaveBeenCalled()
  expect(alert).toHaveBeenCalledWith('修改尚未保存', expect.any(String), expect.any(Array))
  await act(async () => alert.mock.calls[0][2]?.find(button => button.text === '丢弃修改')?.onPress?.())
  expect(navigate).toHaveBeenCalledTimes(1)
  await act(async () => view.unmount())
  alert.mockRestore()
})

test('switching main tabs protects unsaved Feishu settings', async () => {
  jest.mocked(feishuApi).mockResolvedValueOnce({ configured: true, connected: true, expired: false, name: '测试', notify_self: true, groups: [], auto_publish: false }).mockResolvedValueOnce([])
  const guard: React.MutableRefObject<((destination: () => void) => void) | undefined> = { current: undefined }
  const navigate = jest.fn()
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {})
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<FeishuSettingsScreen onBack={jest.fn()} navigationGuard={guard} />) })
  await act(async () => view.root.findAllByType(SettingsCheckbox)[0].props.onChange(false))
  await act(async () => guard.current?.(navigate))
  expect(navigate).not.toHaveBeenCalled()
  await act(async () => alert.mock.calls[0][2]?.find(button => button.text === '丢弃修改')?.onPress?.())
  expect(navigate).toHaveBeenCalledTimes(1)
  await act(async () => view.unmount())
  expect(guard.current).toBeUndefined()
  alert.mockRestore()
})

test('missing service configuration is an explicit disabled setup state, not a network retry loop', async () => {
  jest.mocked(feishuApi).mockResolvedValueOnce({ configured: false, connected: false, expired: false, notify_self: false, groups: [], auto_publish: false, setup: { missing: ['application'] } })
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<FeishuSettingsScreen onBack={jest.fn()} />) })
  expect(view.root.findAllByType(PrimaryButton).find(node => node.props.title === '连接飞书')!.props.disabled).toBe(true)
  expect(view.root.findAllByType(PrimaryButton).some(node => node.props.title === '重新加载')).toBe(false)
  expect(JSON.stringify(view.toJSON())).toContain('授权服务尚未就绪')
  await act(async () => view.unmount())
})

test('a failed settings save preserves selected preferences for retry', async () => {
  const status = { configured: true, connected: true, expired: false, name: '测试', notify_self: true, groups: [], auto_publish: false }
  jest.mocked(feishuApi).mockResolvedValueOnce(status).mockResolvedValueOnce([])
  jest.mocked(saveFeishuLocalPreferences).mockRejectedValueOnce(new Error('本机存储暂不可用')).mockResolvedValueOnce(undefined)
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<FeishuSettingsScreen onBack={jest.fn()} />) })
  await act(async () => view.root.findAllByType(SettingsCheckbox)[0].props.onChange(false))
  const save = () => view.root.findAllByType(PrimaryButton).find(node => ['保存设置', '重试保存'].includes(node.props.title))!
  await act(async () => save().props.onPress())
  expect(view.root.findAllByType(SettingsCheckbox)[0].props.checked).toBe(false)
  expect(save().props.disabled).toBe(false)
  await act(async () => save().props.onPress())
  expect(saveFeishuLocalPreferences).toHaveBeenLastCalledWith('owner', { notify_self: false, groups: [], destination_config: { kind: 'personal' }, permission_policy: 'private' })
  expect(jest.mocked(feishuApi).mock.calls.some(call => call[0] === '/preferences')).toBe(false)
  await act(async () => view.unmount())
})

test('a failed status read leaves account connection disabled', async () => {
  jest.mocked(feishuApi).mockRejectedValueOnce(new Error('尚未启用'))
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<FeishuSettingsScreen onBack={jest.fn()} />) })
  expect(view.root.findAllByType(PrimaryButton).some(node => node.props.title === '连接飞书')).toBe(false)
  expect(JSON.stringify(view.toJSON())).toContain('连接状态尚未读取')
  expect(JSON.stringify(view.toJSON())).not.toContain('自动交付新纪要')
  await act(async () => view.unmount())
})

test('group refresh errors and retry remain in the picker without clearing choices', async () => {
  const status = { configured: true, connected: true, expired: false, name: '测试', notify_self: true, groups: ['g1'], auto_publish: false }
  const groups = [{ chat_id: 'g1', name: '项目群' }]
  jest.mocked(readFeishuLocalPreferences).mockResolvedValueOnce({ notify_self: true, groups: ['g1'], destination_config: { kind: 'personal' }, permission_policy: 'private' })
  jest.mocked(feishuApi).mockResolvedValueOnce(status).mockResolvedValueOnce(groups).mockRejectedValueOnce(new Error('暂时断网')).mockResolvedValueOnce(groups)
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<FeishuSettingsScreen onBack={jest.fn()} />) })
  const picker = view.root.findAll(node => node.props.accessibilityLabel === '选择通知群' && typeof node.props.onPress === 'function')[0]
  await act(async () => picker.props.onPress())
  const refresh = () => view.root.findAllByType(PrimaryButton).filter(node => node.props.title === '刷新群列表').at(-1)!
  await act(async () => refresh().props.onPress())
  expect(JSON.stringify(view.toJSON())).toContain('暂时断网')
  expect(view.root.findAll(node => node.props.accessibilityRole === 'checkbox' && node.props.accessibilityLabel !== '发给我本人' && node.props.accessibilityLabel !== '发给指定群')[0].props.accessibilityState.checked).toBe(true)
  await act(async () => refresh().props.onPress())
  expect(JSON.stringify(view.toJSON())).not.toContain('暂时断网')
  await act(async () => view.unmount())
})

test('authorization verification keeps pending preferences even when the group read fails', async () => {
  const status = { configured: true, connected: true, expired: false, name: '测试', notify_self: true, groups: ['g1'], auto_publish: false }
  jest.mocked(feishuApi).mockResolvedValueOnce(status).mockResolvedValueOnce([]).mockResolvedValueOnce({ url: 'https://example.invalid/authorize' }).mockResolvedValueOnce(status).mockRejectedValueOnce(new Error('群服务暂不可用'))
  const { Linking } = require('react-native')
  jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined)
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<FeishuSettingsScreen onBack={jest.fn()} />) })
  await act(async () => view.root.findAllByType(SettingsCheckbox)[0].props.onChange(false))
  const press = (title: string) => view.root.findAllByType(PrimaryButton).find(node => node.props.title === title)!
  await act(async () => view.root.findAll(node => node.props.accessibilityLabel === '管理连接' && typeof node.props.onPress === 'function')[0].props.onPress())
  await act(async () => press('重新连接飞书').props.onPress())
  await act(async () => press('我已完成授权').props.onPress())
  expect(view.root.findAllByType(SettingsCheckbox)[0].props.checked).toBe(false)
  expect(press('保存设置').props.disabled).toBe(false)
  expect(JSON.stringify(view.toJSON())).toContain('群服务暂不可用')
  expect(JSON.stringify(view.toJSON())).not.toContain('保存失败')
  await act(async () => view.unmount())
})


test.each([{ connection_state: 'service_unavailable' }, { grant_state: 'unavailable' }])('temporary verification reads status again instead of reauthorizing %j', async unavailable => {
  const status = { configured: true, connected: true, expired: false, name: '测试', notify_self: false, groups: [], auto_publish: false };
  jest.mocked(feishuApi).mockResolvedValueOnce({ ...status, connected: false, ...unavailable }).mockResolvedValueOnce(status).mockResolvedValueOnce([]);
  let view!: Renderer.ReactTestRenderer;
  await act(async () => { view = Renderer.create(<FeishuSettingsScreen onBack={jest.fn()} />) });
  expect(JSON.stringify(view.toJSON())).toContain('连接暂时无法核验');
  expect(JSON.stringify(view.toJSON())).not.toContain('需要重新授权');
  expect(view.root.findAllByType(PrimaryButton).some(node => node.props.title === '连接飞书')).toBe(false);
  await act(async () => view.root.findAllByType(PrimaryButton).find(node => node.props.title === '重新核验飞书连接')!.props.onPress());
  expect(jest.mocked(feishuApi).mock.calls.map(call => call[0])).toEqual(['/status', '/status', '/groups']);
  await act(async () => view.unmount());
});
