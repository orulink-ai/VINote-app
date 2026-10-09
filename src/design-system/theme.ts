import { StyleSheet } from 'react-native'

// Quiet, high-contrast surfaces inspired by assistant-ui Native's demo.
export const colors = {
  ink: '#18181B', muted: '#71717A', subtle: '#A1A1AA', line: '#E4E4E7',
  canvas: '#FAFAFA', card: '#FFFFFF', primary: '#18181B', primarySoft: '#F4F4F5',
  danger: '#C43838', dangerSoft: '#FEF2F2', success: '#16805D', successSoft: '#ECFDF5',
}

export const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.canvas },
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingHorizontal: 22, paddingTop: 20, paddingBottom: 32, gap: 16 },
  loginContent: { flexGrow: 1, paddingTop: 42, paddingBottom: 36 },
  recordContent: { paddingTop: 32 },
  eyebrow: { color: colors.muted, fontFamily: 'sans-serif', fontSize: 11, fontWeight: '700', letterSpacing: 1.6 },
  title: { color: colors.ink, fontFamily: 'sans-serif', fontSize: 31, lineHeight: 39, fontWeight: '700', letterSpacing: -0.9 },
  subtitle: { color: colors.muted, fontFamily: 'sans-serif', fontSize: 14, lineHeight: 21 },
  label: { color: colors.ink, fontFamily: 'sans-serif', fontSize: 13, fontWeight: '600', marginBottom: 8 },
  input: { minHeight: 54, backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12, color: colors.ink, fontFamily: 'sans-serif', fontSize: 16 },
  inputFocused: { borderColor: colors.ink, borderWidth: 1.5 },
  button: { minHeight: 52, backgroundColor: colors.primary, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#FFFFFF', fontFamily: 'sans-serif', fontSize: 15, fontWeight: '600' },
  secondaryButton: { minHeight: 48, backgroundColor: colors.primarySoft, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  secondaryButtonText: { color: colors.ink, fontFamily: 'sans-serif', fontSize: 14, fontWeight: '600', textAlign: 'center' },
  textButton: { minHeight: 44, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
  textButtonText: { color: colors.ink, fontFamily: 'sans-serif', fontSize: 14, fontWeight: '600' },
  card: { backgroundColor: colors.card, borderRadius: 20, padding: 18, borderWidth: 1, borderColor: colors.line, gap: 10 },
  noteTitle: { color: colors.ink, fontFamily: 'sans-serif', fontSize: 17, lineHeight: 24, fontWeight: '600', letterSpacing: -0.3 },
  noteBody: { color: colors.ink, fontFamily: 'sans-serif', fontSize: 16, lineHeight: 27 },
  link: { color: colors.ink, fontFamily: 'sans-serif', fontSize: 14, fontWeight: '600' },
  sectionTitle: { color: colors.ink, fontFamily: 'sans-serif', fontSize: 20, fontWeight: '700', letterSpacing: -0.4 },
  recordCard: { alignItems: 'center', paddingVertical: 44, gap: 16 },
  timer: { color: colors.ink, fontFamily: 'sans-serif', fontSize: 54, lineHeight: 66, fontWeight: '600', fontVariant: ['tabular-nums'], letterSpacing: -2 },
})
