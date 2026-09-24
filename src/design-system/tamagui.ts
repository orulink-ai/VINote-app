import { defaultConfig } from '@tamagui/config/v4'
import { createTamagui } from 'tamagui'
const base = { ...defaultConfig }
Reflect.deleteProperty(base, 'animations')
export const config = createTamagui(base)
