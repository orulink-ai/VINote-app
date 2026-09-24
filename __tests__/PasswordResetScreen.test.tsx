import { TamaguiProvider } from 'tamagui'
import { config } from '../src/design-system/tamagui'
import React from 'react'
import { Alert } from 'react-native'
import Renderer, { act } from 'react-test-renderer'
import { PasswordResetScreen } from '../src/screens/PasswordResetScreen'
import { Field } from '../src/components/Field'
import { PrimaryButton } from '../src/components/PrimaryButton'
import * as auth from '../src/lib/auth'

jest.mock('../src/lib/auth', () => ({
  requestPasswordReset: jest.fn(async () => ({ message: 'sent' })),
  resetPassword: jest.fn(async () => ({ message: 'done' })),
}))

test('email reset validates passwords, preserves failed verification, and returns to login on success', async () => {
  jest.spyOn(Alert, 'alert').mockImplementation(() => {})
  const back = jest.fn()
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<TamaguiProvider config={config} defaultTheme="light"><PasswordResetScreen onBack={back} /></TamaguiProvider>) })
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
