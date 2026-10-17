const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const defaults = getDefaultConfig(__dirname);
const escapedRoot = __dirname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Native builds, bundled inference models and journals are not JS inputs.
// Excluding only these root directories keeps source/brand assets hot-reloadable.
const nativeOutputs = new RegExp(`^${escapedRoot}[/\\\\](android|ios|documents)[/\\\\]`);
const existingBlocks = defaults.resolver.blockList;
const config = {
  maxWorkers: 2,
  resolver: {
    blockList: [...(Array.isArray(existingBlocks) ? existingBlocks : existingBlocks ? [existingBlocks] : []), nativeOutputs],
  },
};

module.exports = mergeConfig(defaults, config);
