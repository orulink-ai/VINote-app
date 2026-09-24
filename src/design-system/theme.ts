import { StyleSheet } from 'react-native'

export const colors = { ink: '#182230', muted: '#657287', line: '#E3E8EF', canvas: '#F5F6F2', card: '#FFFFFF', primary: '#176B5B', primarySoft: '#E5F2EC', danger: '#C43D4B', success: '#1A8B67' }

export const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.canvas },
  loginContent: { paddingTop: 64 },
  recordContent: { paddingTop: 48 },
  recordCard: { alignItems: 'center', paddingVertical: 48 },
  timer: { fontSize: 48, fontWeight: '600' },
  noteTitle: { color: colors.ink, fontSize: 18, fontWeight: '600' },
  noteBody: { color: '#273244', fontSize: 16, lineHeight: 25 },
  link: { color: colors.primary, fontWeight: '600' },
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: 24, gap: 16 },
  title: { color: colors.ink, fontSize: 28, fontWeight: '600' },
  subtitle: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  label: { color: colors.ink, fontSize: 14, fontWeight: '700', marginBottom: 8 },
  input: { backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 14, color: colors.ink, fontSize: 16 },
  button: { backgroundColor: colors.primary, borderRadius: 10, padding: 16, alignItems: 'center' },
  buttonText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  secondaryButton: { backgroundColor: colors.primarySoft, borderRadius: 10, padding: 16, alignItems: 'center' },
  secondaryButtonText: { color: colors.primary, fontSize: 16, fontWeight: '600' },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 18, borderWidth: 1, borderColor: colors.line, gap: 8 },
})
