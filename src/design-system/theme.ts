import { StyleSheet } from 'react-native'

// Shared neutral palette inspired by the assistant-ui Native demo.
export const colors = { ink: '#18181B', muted: '#71717A', line: '#E4E4E7', canvas: '#FFFFFF', card: '#FFFFFF', primary: '#18181B', primarySoft: '#F4F4F5', danger: '#DC2626', success: '#16805D' }

export const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.canvas },
  loginContent: { paddingTop: 72 },
  recordContent: { paddingTop: 48 },
  recordCard: { alignItems: 'center', paddingVertical: 48 },
  timer: { fontSize: 48, fontWeight: '600' },
  noteTitle: { color: colors.ink, fontSize: 18, fontWeight: '600' },
  noteBody: { color: colors.ink, fontSize: 16, lineHeight: 27 },
  link: { color: colors.primary, fontWeight: '600' },
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: 20, gap: 18 },
  title: { color: colors.ink, fontSize: 29, fontWeight: '700', letterSpacing: -0.7 },
  subtitle: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  label: { color: colors.ink, fontSize: 14, fontWeight: '600', marginBottom: 8 },
  input: { backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: 18, paddingHorizontal: 16, paddingVertical: 14, color: colors.ink, fontSize: 16 },
  button: { backgroundColor: colors.primary, borderRadius: 18, padding: 16, alignItems: 'center' },
  buttonText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  secondaryButton: { backgroundColor: colors.primarySoft, borderRadius: 18, padding: 16, alignItems: 'center' },
  secondaryButtonText: { color: colors.primary, fontSize: 16, fontWeight: '600' },
  card: { backgroundColor: colors.card, borderRadius: 20, padding: 20, borderWidth: 1, borderColor: colors.line, gap: 10 },
})
