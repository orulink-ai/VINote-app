import { formatDuration } from '../src/lib/formatDuration'
test.each([[0, '0:00'], [42, '0:42'], [59.9, '0:59'], [60, '1:00'], [3600, '1:00:00'], [3661, '1:01:01']] as const)('uses measured seconds without rounding to whole minutes: %s', (value, label) => {
  expect(formatDuration(value)).toBe(label)
})
test.each([undefined, null, NaN, Infinity, -1])('invalid duration remains unknown: %s', value => {
  expect(formatDuration(value)).toBe('时长未知')
})
