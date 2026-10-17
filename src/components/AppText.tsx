import React from 'react'
import { Text as NativeText, type TextProps } from 'react-native'
import { fontFamily } from '../design-system/theme'

// Keep the product typography consistent when an Android theme replaces system fonts.
export const Text = React.forwardRef<React.ComponentRef<typeof NativeText>, TextProps>(
  ({ style, ...props }, ref) => <NativeText ref={ref} {...props} style={[{ fontFamily, includeFontPadding: false }, style]} />,
)
Text.displayName = 'AppText'
