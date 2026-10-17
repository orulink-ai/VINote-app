import React from 'react'
import { Alert, BackHandler } from 'react-native'
import Renderer, { act } from 'react-test-renderer'
import { PasswordResetScreen } from '../src/screens/PasswordResetScreen'
import { Field } from '../src/components/Field'
import { PrimaryButton } from '../src/components/PrimaryButton'
import * as auth from '../src/lib/auth'
import { ScreenHeader } from '../src/components/ScreenHeader'

jest.mock('../src/lib/auth', () => ({
  requestPasswordReset: jest.fn(async () => ({ message: 'sent' })),
  resetPassword: jest.fn(async () => ({ message: 'done' })),
}))

test('email reset validates passwords, preserves failed verification, and returns to login on success', async () => {
  jest.spyOn(Alert, 'alert').mockImplementation(() => {})
  const back = jest.fn()
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<><PasswordResetScreen onBack={back} /></>) })
  const fill = async (label: string, value: string) => {
    await act(async () => view.root.findAllByType(Field).find(field => field.props.label === label)!.props.onChangeText(value))
  }
  const press = async (title: string) => {
    await act(async () => { await view.root.findAllByType(PrimaryButton).find(button => button.props.title === title)!.props.onPress() })
  }
  await fill('邮箱', ' User@Example.com ')
  await press('发送重置验证码')
  expect(auth.requestPasswordReset).toHaveBeenCalledWith('user@example.com')
  expect(view.root.findAllByType(Field)[0].props.editable).toBe(false)
  await fill('邮箱验证码', '123456')
  await fill('新密码', 'password123')
  await fill('确认新密码', 'different')
  await press('确认重置密码')
  expect(auth.resetPassword).not.toHaveBeenCalled()
  await fill('确认新密码', 'password123')
  jest.mocked(auth.resetPassword).mockRejectedValueOnce(new Error('验证码已过期'))
  await press('确认重置密码')
  expect(back).not.toHaveBeenCalled()
  expect(Alert.alert).toHaveBeenCalledWith('重置失败', '验证码已过期')
  await press('确认重置密码')
  expect(auth.resetPassword).toHaveBeenLastCalledWith('user@example.com', '123456', 'password123')
  expect(back).toHaveBeenCalledTimes(1)
  await act(async () => view.unmount())
})

test('hardware and header return to login without submission and remove listener on unmount', async () => {
  const remove = jest.fn(), back = jest.fn()
  let hardware!: () => boolean | null | undefined
  const listener = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((event, handler) => { hardware = () => handler({ type: 'hardwareBackPress', timeStamp: 0 }); return { remove } })
  let view!: Renderer.ReactTestRenderer
  try {
    await act(async () => { view = Renderer.create(<PasswordResetScreen onBack={back} />) })
    const resets = jest.mocked(auth.resetPassword).mock.calls.length
    await act(async () => { expect(hardware()).toBe(true) })
    await act(async () => view.root.findByType(ScreenHeader).props.onBack())
    expect(back).toHaveBeenCalledTimes(2)
    expect(auth.resetPassword).toHaveBeenCalledTimes(resets)
    await act(async () => view.unmount())
    expect(remove).toHaveBeenCalledTimes(1)
  } finally { listener.mockRestore() }
})

test('busy send consumes hardware back and blocks header; failure preserves email and re-enables return', async () => {
  const back = jest.fn(), remove = jest.fn()
  let hardware!: () => boolean | null | undefined
  const listener = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((event, handler) => { hardware = () => handler({ type: 'hardwareBackPress', timeStamp: 0 }); return { remove } })
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {})
  let reject!: (reason: Error) => void, pending!: Promise<void>, view!: Renderer.ReactTestRenderer
  jest.mocked(auth.requestPasswordReset).mockImplementationOnce(() => new Promise((_, fail) => { reject = fail }))
  try {
    await act(async () => { view = Renderer.create(<PasswordResetScreen onBack={back} />) })
    await act(async () => view.root.findByType(Field).props.onChangeText('saved@example.com'))
    await act(async () => { pending = view.root.findAllByType(PrimaryButton).find(node => node.props.title === '发送重置验证码')!.props.onPress() })
    await act(async () => { expect(hardware()).toBe(true); view.root.findByType(ScreenHeader).props.onBack() })
    expect(back).not.toHaveBeenCalled()
    expect(view.root.findByType(Field).props.value).toBe('saved@example.com')
    expect(view.root.findByType(ScreenHeader).props.disabled).toBe(true)
    await act(async () => { reject(new Error('网络未连接')); await pending })
    expect(view.root.findByType(Field).props.value).toBe('saved@example.com')
    expect(view.root.findByType(ScreenHeader).props.disabled).toBe(false)
    await act(async () => { expect(hardware()).toBe(true) })
    expect(back).toHaveBeenCalledTimes(1)
    await act(async () => view.unmount())
    expect(remove).toHaveBeenCalledTimes(1)
  } finally { listener.mockRestore(); alert.mockRestore() }
})

test('reset in flight blocks hardware return until the original successful reset returns once', async () => {
  const back = jest.fn()
  let hardware!: () => boolean | null | undefined
  const listener = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((event, handler) => { hardware = () => handler({ type: 'hardwareBackPress', timeStamp: 0 }); return { remove: jest.fn() } })
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {})
  let finish!: () => void, pending!: Promise<void>, view!: Renderer.ReactTestRenderer
  jest.mocked(auth.resetPassword).mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ message: 'done' }) }))
  try {
    await act(async () => { view = Renderer.create(<PasswordResetScreen onBack={back} />) })
    const fill = async (label: string, value: string) => { await act(async () => view.root.findAllByType(Field).find(node => node.props.label === label)!.props.onChangeText(value)) }
    await fill('邮箱', 'saved@example.com')
    await act(async () => view.root.findAllByType(PrimaryButton).find(node => node.props.title === '发送重置验证码')!.props.onPress())
    await fill('邮箱验证码', '123456'); await fill('新密码', 'password123'); await fill('确认新密码', 'password123')
    await act(async () => { pending = view.root.findAllByType(PrimaryButton).find(node => node.props.title === '确认重置密码')!.props.onPress() })
    await act(async () => { expect(hardware()).toBe(true) })
    expect(back).not.toHaveBeenCalled()
    await act(async () => { finish(); await pending })
    expect(back).toHaveBeenCalledTimes(1)
    await act(async () => view.unmount())
  } finally { listener.mockRestore(); alert.mockRestore() }
})
