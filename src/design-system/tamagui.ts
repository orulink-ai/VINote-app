import { defaultConfig } from '@tamagui/config/v4'
import { createTamagui } from 'tamagui'
const { animations, ...base } = defaultConfig
export const config = createTamagui(base)
