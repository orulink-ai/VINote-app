module.exports = {
  preset: '@react-native/jest-preset',
  transformIgnorePatterns: ['node_modules/(?!((jest-)?react-native|@react-native(-community)?|react-native-markdown-display|tamagui|@tamagui|@floating-ui)/)'],
  setupFilesAfterEnv: ['./jest.setup.js'],
};
