// Metro (Expo SDK 57): общий с сайтом код лежит в ../shared — подключаем папку к сборке.
// В shared/ только чистый TypeScript без зависимостей, поэтому разрешать node_modules
// оттуда не нужно. EAS Build берёт весь git-репозиторий, так что папка есть и в облаке.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
config.watchFolders = [...(config.watchFolders || []), path.resolve(__dirname, "../shared")];

module.exports = config;
