import { versionRecordLabel, versionRecordTime } from '../src/lib/versionRecordLabel'
test('legacy and imported records are not described as model generations', () => {
  expect(versionRecordLabel()).toBe('保存记录')
  expect(versionRecordLabel('snapshot')).toBe('保存记录')
  expect(versionRecordLabel('imported')).toBe('导入记录')
  expect(versionRecordLabel('generated')).toBe('生成版本')
  expect(versionRecordLabel('edit')).toBe('编辑记录')
  expect(versionRecordTime(undefined)).toBe('保存时间未记录')
  expect(versionRecordTime('invalid')).toBe('保存时间未记录')
})
