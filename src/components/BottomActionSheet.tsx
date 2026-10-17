import { Text } from './AppText'
import React, { createContext, useContext, useEffect, useState } from 'react'
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { colors, styles } from '../design-system/theme'
import { useReducedMotion } from '../design-system/motion'

const FooterSlot = createContext<React.Dispatch<React.SetStateAction<React.ReactNode>> | null>(null)
/** Keeps the submitting action outside the sheet's scrolling content. */
export function BottomActionSheetFooter({ children }: { children: React.ReactNode }) {
  const setFooter = useContext(FooterSlot)
  useEffect(() => {
    if (!setFooter) return
    setFooter(children)
    return () => setFooter(null)
  }, [setFooter, children])
  return setFooter ? null : <>{children}</>
}

export function BottomActionSheet({
  visible,
  title,
  onClose,
  onBack,
  onShown,
  children,
}: {
  visible: boolean
  title: string
  onClose: () => void
  onBack?: () => void
  onShown?: () => void
  children: React.ReactNode
}) {
  const reduced = useReducedMotion()
  const [footer, setFooter] = useState<React.ReactNode>(null)
  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduced ? 'none' : 'fade'}
      onRequestClose={onBack || onClose}
      onShow={onShown}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{
          flex: 1,
          justifyContent: 'flex-end',
          backgroundColor: '#00000055',
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="关闭操作面板"
          onPress={onClose}
          style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }}
        />
        <SafeAreaView
          edges={['bottom']}
          accessibilityViewIsModal
          onAccessibilityEscape={onBack || onClose}
          style={{
            backgroundColor: colors.card,
            borderTopLeftRadius: 26,
            borderTopRightRadius: 26,
            maxHeight: '85%',
          }}
        >
          <View
            style={{
              paddingHorizontal: 20, paddingVertical: 12,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottomWidth: 1,
              borderColor: colors.line,
            }}
          >
            {onBack && <Pressable accessibilityRole="button" accessibilityLabel="返回上一步" onPress={onBack} style={{ minHeight: 48, minWidth: 48, justifyContent: 'center' }}><Text style={styles.link}>‹ 返回</Text></Pressable>}
            <Text accessibilityRole="header" style={[styles.noteTitle, { flex: 1, paddingRight: 12 }]}>{title}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={onClose}
              accessibilityLabel={`关闭${title}`}
              style={[styles.textButton, { minHeight: 48, minWidth: 48, justifyContent: 'center', alignItems: 'center' }]}
            >
              <Text style={styles.link}>关闭</Text>
            </Pressable>
          </View>
          <ScrollView
            style={{ flexShrink: 1 }}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.content}
          >
            <FooterSlot.Provider value={setFooter}>{children}</FooterSlot.Provider>
          </ScrollView>
          {footer}
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  )
}
