const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

config.resolver = {
  ...config.resolver,
  blockList: [
    /\.local\/.*/,
    /\.git\/.*/,
  ],
};

module.exports = config;
