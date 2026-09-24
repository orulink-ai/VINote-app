import { TamaguiProvider } from 'tamagui'
import { config } from '../src/design-system/tamagui'
import React from 'react'
import { Alert } from 'react-native'
import Renderer, { act } from 'react-test-renderer'
import { LoginScreen } from '../src/screens/LoginScreen'
import { Field } from '../src/components/Field'
import { PrimaryButton } from '../src/components/PrimaryButton'
import * as auth from '../src/lib/auth'

jest.mock('../src/lib/auth', () => ({
  getAuthConfig: jest.fn(async () => ({ email_code: true })),
  requestRegistration: jest.fn(async () => ({ message: 'sent' })),
  verifyRegistration: jest.fn(async () => ({})),
  signUp: jest.fn(), signIn: jest.fn(),
}))

test('cloud registration locks credentials and verifies before authentication', async () => {
  jest.spyOn(Alert, 'alert').mockImplementation(() => {})
  const authenticated = jest.fn()
  let view!: Renderer.ReactTestRenderer
  await act(async () => { view = Renderer.create(<TamaguiProvider config={config} defaultTheme="light"><LoginScreen onAuthenticated={authenticated} /></TamaguiProvider>) })
  const press = async (title: string) => {
    await act(async () => { await view.root.findAllByType(PrimaryButton).find(button => button.props.title === title)!.props.onPress() })
  }
  const fill = async (label: string, value: string) => {
    await act(async () => { view.root.findAllByType(Field).find(field => field.props.label === label)!.props.onChangeText(value) })
  }
  await press('没有账号？注册')
  await fill('邮箱', ' User@Example.com ')
  await fill('密码', 'password123')
  await fill('确认密码', 'password123')
  await press('注册账号')
  expect(auth.requestRegistration).toHaveBeenCalledWith('user@example.com', 'password123')
  expect(auth.signUp).not.toHaveBeenCalled()
  expect(authenticated).not.toHaveBeenCalled()
  expect(view.root.findAllByType(Field).find(field => field.props.label === '邮箱')!.props.editable).toBe(false)
  await fill('邮箱验证码', '123456')
  await press('验证并登录')
  expect(auth.verifyRegistration).toHaveBeenCalledWith('user@example.com', '123456')
  expect(authenticated).toHaveBeenCalledTimes(1)
  await press('已有账号，返回登录')
  expect(view.root.findAllByType(Field).every(field => field.props.value === '')).toBe(true)
  await act(async () => view.unmount())
})
