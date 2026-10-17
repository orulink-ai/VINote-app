import { useEffect, useSyncExternalStore } from 'react'
import Storage from '@react-native-async-storage/async-storage'
import { Appearance, Platform, StyleSheet } from 'react-native'

export const fontFamily = Platform.OS === 'ios' ? 'NotoSansSC-Regular' : 'VINoteSans'

// Quiet, high-contrast surfaces inspired by assistant-ui Native's demo.
export const colors = {
  ink: '#202630', muted: '#626B78', subtle: '#646C78', line: '#E7EBF0',
  canvas: '#F5F6F8', card: '#FFFFFF', primary: '#263344', onPrimary: '#FFFFFF', primarySoft: '#EAF0F7',
  danger: '#BA4547', dangerSoft: '#FBECEE', success: '#257B67', successSoft: '#EAF5F0', navigationAccent: '#0969C7',
}

const makeStyles = () => StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.canvas },
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 24, gap: 14 },
  loginContent: { flexGrow: 1, paddingTop: 42, paddingBottom: 36 },
  eyebrow: { color: colors.muted, fontFamily, fontSize: 11, fontWeight: '500', letterSpacing: 1.6 },
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
  listRow: { backgroundColor: colors.card, borderBottomWidth: 1, borderColor: colors.line, paddingVertical: 16, gap: 10 },
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
  Object.assign(colors, dark ? { ink: '#E7ECF4', muted: '#A0ABBB', subtle: '#7E8A9D', line: '#303948', canvas: '#141A23', card: '#1C2430', primary: '#CEDAF0', onPrimary: '#172130', primarySoft: '#2A3749', danger: '#F19A9F', dangerSoft: '#42272E', success: '#7ED8BB', successSoft: '#1D3933', navigationAccent: '#80BFFF' } : light)
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
