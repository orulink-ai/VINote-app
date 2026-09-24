import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { TamaguiProvider } from 'tamagui'
import { config } from '../src/design-system/tamagui'
import { RenameDialog } from '../src/components/RenameDialog'
import { Field } from '../src/components/Field'
import { PrimaryButton } from '../src/components/PrimaryButton'
test('rename preserves input on failure and closes only after successful save', async () => {
 const save = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined)
 const close = jest.fn()
 let view!: Renderer.ReactTestRenderer
 await act(async () => { view = Renderer.create(<TamaguiProvider config={config} defaultTheme="light"><RenameDialog title="旧名称" onSave={save} onClose={close} /></TamaguiProvider>) })
 await act(async () => view.root.findByType(Field).props.onChangeText(' 新会议 '))
 await act(async () => view.root.findAllByType(PrimaryButton)[0].props.onPress())
 expect(save).toHaveBeenLastCalledWith('新会议')
 expect(close).not.toHaveBeenCalled()
 expect(view.root.findByType(Field).props.value).toBe(' 新会议 ')
 await act(async () => view.root.findAllByType(PrimaryButton)[0].props.onPress())
 expect(close).toHaveBeenCalledTimes(1)
 await act(async () => view.unmount())
})
