const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const config = {
  projectRoot: __dirname,
  watchFolders: [__dirname],
  server: {
    port: 8082,
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
