import { useEffect, useSyncExternalStore } from 'react'
import Storage from '@react-native-async-storage/async-storage'
import { Appearance, Platform, StyleSheet } from 'react-native'

export const fontFamily = Platform.OS === 'ios' ? 'NotoSansSC-Regular' : 'VINoteSans'

// Quiet, high-contrast surfaces inspired by assistant-ui Native's demo.
export const colors = {
  ink: '#1C1C1E', muted: '#63636A', subtle: '#81818A', line: '#E5E5EA',
  canvas: '#F2F2F7', card: '#FFFFFF', primary: '#007AFF', onPrimary: '#FFFFFF', primarySoft: '#E8F2FF',
  danger: '#C83D42', dangerSoft: '#FBECEE', success: '#247B64', successSoft: '#EAF5F0', navigationAccent: '#007AFF',
}

const makeStyles = () => StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.canvas },
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 24, gap: 14 },
  loginContent: { flexGrow: 1, paddingTop: 42, paddingBottom: 36 },
  eyebrow: { color: colors.muted, fontFamily, fontSize: 11, fontWeight: '500', letterSpacing: 0.2 },
  title: { color: colors.ink, fontFamily, fontSize: 23, lineHeight: 31, fontWeight: '500', letterSpacing: -0.4 },
  subtitle: { color: colors.muted, fontFamily, fontSize: 13, lineHeight: 20 },
  label: { color: colors.ink, fontFamily, fontSize: 13, fontWeight: '500', marginBottom: 8 },
  input: { minHeight: 48, backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, color: colors.ink, fontFamily, fontSize: 14 },
  inputFocused: { borderColor: colors.primary, borderWidth: 1, backgroundColor: colors.primarySoft },
  button: { minHeight: 48, backgroundColor: colors.primary, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: colors.onPrimary, fontFamily, fontSize: 14, lineHeight: 21, fontWeight: '500' },
  secondaryButton: { minHeight: 48, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  secondaryButtonText: { color: colors.ink, fontFamily, fontSize: 14, lineHeight: 22, fontWeight: '500', textAlign: 'center' },
  textButton: { minHeight: 44, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
  textButtonText: { color: colors.ink, fontFamily, fontSize: 14, lineHeight: 22, fontWeight: '500' },
  card: { backgroundColor: colors.card, shadowColor: '#101828', shadowOpacity: 0.035, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 1, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: colors.line, gap: 12 },
  listRow: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 15, gap: 10 },
  emptyState: { paddingVertical: 36, gap: 10 },
  pageTitle: { color: colors.ink, fontFamily, fontSize: 23, lineHeight: 31, fontWeight: '500' },
  noteTitle: { color: colors.ink, fontFamily, fontSize: 14, lineHeight: 21, fontWeight: '500' },
  noteBody: { color: colors.ink, fontFamily, fontSize: 14, lineHeight: 24 },
  link: { color: colors.ink, fontFamily, fontSize: 14, lineHeight: 22, fontWeight: '500' },
  sectionTitle: { color: colors.ink, fontFamily, fontSize: 20, fontWeight: '500', letterSpacing: -0.4 },
  timer: { color: colors.ink, fontFamily, fontSize: 54, lineHeight: 66, fontWeight: '500', fontVariant: ['tabular-nums'], letterSpacing: -2 },
})

export let styles = makeStyles()
export type AppearanceMode = 'system' | 'light' | 'dark'
const light = { ...colors }
let mode: AppearanceMode = 'system'
let revision = 0
const listeners = new Set<() => void>()
function applyAppearance() {
  const dark = mode === 'dark' || (mode === 'system' && Appearance.getColorScheme() === 'dark')
  Object.assign(colors, dark ? { ink: '#F2F2F7', muted: '#A6A6AE', subtle: '#85858F', line: '#38383F', canvas: '#111114', card: '#222226', primary: '#0A84FF', onPrimary: '#FFFFFF', primarySoft: '#173655', danger: '#F19A9F', dangerSoft: '#42272E', success: '#7ED8BB', successSoft: '#1D3933', navigationAccent: '#66AEFF' } : light)
  styles = makeStyles(); revision++; listeners.forEach(listener => listener())
}
export function getAppearanceMode() { return mode }
export async function setAppearanceMode(next: AppearanceMode) {
  await Storage.setItem('vinote:appearance', next)
  mode = next; applyAppearance()
}
export function useAppAppearance() {
  useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => revision)
  useEffect(() => {
    let active = true
    void Storage.getItem('vinote:appearance').then(value => { if (!active) return; if (value === 'light' || value === 'dark' || value === 'system') mode = value; applyAppearance() }).catch(() => {})
    const subscription = Appearance.addChangeListener(() => { if (mode === 'system') applyAppearance() })
    return () => { active = false; subscription.remove() }
  }, [])
  return mode === 'dark' || (mode === 'system' && Appearance.getColorScheme() === 'dark')
}
