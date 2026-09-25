// Подпись release-сборки своим ключом, а не debug-ключом Android: APK с «Android Debug»
// Play Protect считает небезопасным. Ключ и пароли — вне репозитория, в свойствах Gradle
// (~/.gradle/gradle.properties или -P...):
//   NEIROMASTER_UPLOAD_STORE_FILE, NEIROMASTER_UPLOAD_STORE_PASSWORD,
//   NEIROMASTER_UPLOAD_KEY_ALIAS, NEIROMASTER_UPLOAD_KEY_PASSWORD
// Плагин нужен потому, что android/ генерируется (expo prebuild) и ручные правки теряются.
const { withAppBuildGradle } = require("expo/config-plugins");

const MARK = "// neiromaster-release-signing";

const SIGNING = `
        release { ${MARK}
            if (project.hasProperty('NEIROMASTER_UPLOAD_STORE_FILE')) {
                storeFile file(NEIROMASTER_UPLOAD_STORE_FILE)
                storePassword NEIROMASTER_UPLOAD_STORE_PASSWORD
                keyAlias NEIROMASTER_UPLOAD_KEY_ALIAS
                keyPassword NEIROMASTER_UPLOAD_KEY_PASSWORD
            }
        }`;

const PICK = `signingConfig(project.hasProperty('NEIROMASTER_UPLOAD_STORE_FILE') ? signingConfigs.release : {
                logger.warn("ВНИМАНИЕ: нет ключа NEIROMASTER_UPLOAD_* — release подписан debug-ключом, Play Protect пометит APK как небезопасный")
                signingConfigs.debug
            }())`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (src.includes(MARK)) return cfg;
    const debugBlock = /(signingConfigs \{\s*debug \{[^}]*\})/;
    const releaseUse = /(release \{[^}]*?)signingConfig signingConfigs\.debug/;
    if (!debugBlock.test(src) || !releaseUse.test(src)) {
      throw new Error("withReleaseSigning: не найден шаблон signingConfigs в android/app/build.gradle");
    }
    src = src.replace(debugBlock, `$1${SIGNING}`).replace(releaseUse, `$1${PICK}`);
    cfg.modResults.contents = src;
    return cfg;
  });
};
