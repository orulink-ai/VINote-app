require('./src/design-system/tamagui');

jest.mock('react-native-fs', () => ({ DocumentDirectoryPath: '/documents', stat: jest.fn(), readFile: jest.fn(), copyFile: jest.fn(), unlink: jest.fn(async () => {}), mkdir: jest.fn(), writeFile: jest.fn(), moveFile: jest.fn(), exists: jest.fn(async () => false), readDir: jest.fn(async () => []) }));
jest.mock('react-native-share', () => ({ open: jest.fn() }));

jest.mock('@react-native-async-storage/async-storage', () => {
  const values = new Map();
  return { getItem: jest.fn(async key => values.get(key) || null), setItem: jest.fn(async (key, value) => { values.set(key, value) }), removeItem: jest.fn(async key => { values.delete(key) }), getAllKeys: jest.fn(async () => [...values.keys()]) };
});
