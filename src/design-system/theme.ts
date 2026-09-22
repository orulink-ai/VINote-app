import { StyleSheet } from 'react-native'

export const colors = { ink: '#182230', muted: '#657287', line: '#E3E8EF', canvas: '#F7F9FC', card: '#FFFFFF', primary: '#355CFF', primarySoft: '#E9EDFF', danger: '#C43D4B', success: '#1A8B67' }

export const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.canvas },
  loginContent: { paddingTop: 72 },
  recordContent: { paddingTop: 56 },
  recordCard: { alignItems: 'center', paddingVertical: 48 },
  timer: { fontSize: 48, fontWeight: '800' },
  noteTitle: { color: colors.ink, fontSize: 18, fontWeight: '800' },
  noteBody: { color: '#273244', fontSize: 16, lineHeight: 25 },
  link: { color: colors.primary, fontWeight: '800' },
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: 24, gap: 16 },
  title: { color: colors.ink, fontSize: 30, fontWeight: '800' },
  subtitle: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  label: { color: colors.ink, fontSize: 14, fontWeight: '700', marginBottom: 8 },
  input: { backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, color: colors.ink, fontSize: 16 },
  button: { backgroundColor: colors.primary, borderRadius: 14, padding: 16, alignItems: 'center' },
  buttonText: { color: '#FFF', fontSize: 16, fontWeight: '800' },
  secondaryButton: { backgroundColor: colors.primarySoft, borderRadius: 14, padding: 16, alignItems: 'center' },
  secondaryButtonText: { color: colors.primary, fontSize: 16, fontWeight: '800' },
  card: { backgroundColor: colors.card, borderRadius: 20, padding: 18, borderWidth: 1, borderColor: colors.line, gap: 8 },
})
