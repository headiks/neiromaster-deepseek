# НейроМастер — приложение сотрудника (Expo SDK 57, дизайн Glass)

Кабинет сотрудника на телефоне: сообщения плана адаптации, история, вопросы ассистенту
и специалисту, больничный. Выглядит и работает так же, как кабинет на сайте в узком окне:
общий код — в `../shared` (типы, API сотрудника, даты, прогресс, статусы, токены дизайна).

## Запуск

```bash
cd mobile
npm ci
npx expo start                       # Expo Go / dev-клиент
EXPO_PUBLIC_API_BASE=http://192.168.0.10:8000 npx expo start   # свой бэкенд
```

Сборка APK/AAB — EAS (`eas.json`, профили `preview` и `production`, API — прод).
EAS берёт весь git-репозиторий, поэтому папка `../shared` попадает в сборку.

### Подпись release-сборки

Release подписывается ключом НейроМастера (`plugins/withReleaseSigning.js`), а не debug-ключом
Android: APK с «Android Debug» Play Protect помечает как небезопасный. Ключ и пароли — вне
репозитория, в свойствах Gradle (`~/.gradle/gradle.properties`):

```
NEIROMASTER_UPLOAD_STORE_FILE=C:/Users/<user>/.neiromaster/neiromaster-release.jks
NEIROMASTER_UPLOAD_STORE_PASSWORD=…
NEIROMASTER_UPLOAD_KEY_ALIAS=neiromaster
NEIROMASTER_UPLOAD_KEY_PASSWORD=…
```

Без них release подписывается debug-ключом, и сборка пишет предупреждение. **Ключ и пароль
храните в резервной копии**: потерянный ключ не восстановить, а APK с другим ключом не встанет
поверх установленного — всем придётся удалять приложение. Локальная сборка:

```bash
npx expo prebuild --platform android --no-install
cd android && ./gradlew assembleRelease bundleRelease   # APK — на сайт, AAB — в Google Play
```

APK выкладывается на сервер в `data/app/NeiroMaster.apk` — его отдаёт страница `/app` сайта.
Перед сборкой увеличьте `android.versionCode` в `app.json`.

## Как устроено

| Файл | Что внутри |
|---|---|
| `App.tsx` | Шрифт Manrope, тема, вход, экраны и плавающий таб-бар «Чат / История / Вопрос / Настройки» |
| `src/theme.ts` | Палитры светлой/тёмной темы и размеры — из `shared/tokens.ts`; тема по системе или выбору |
| `src/ui/` | UI-кит: фон с градиентом, стекло (`expo-blur`), текст, кнопка, бейдж, сегмент, чип, прогресс, переключатель |
| `src/data.tsx` | Входящие (опрос раз в 30 с), расписание, вопросы, диалог с ассистентом |
| `src/screens/` | Вход (+ смена временного пароля), Сегодня, История, Вопрос, Настройки, «Как пользоваться» |
| `metro.config.js` | Подключает `../shared` к сборке |

Размытие на Android (SDK 57): `BlurView` размывает только содержимое `BlurTargetView`,
поэтому фон экрана обёрнут в него (`GlassBackground`), а стеклянные элементы получают его
через `blurTarget` с методом `dimezisBlurViewSdk31Plus` (на Android 11 и ниже — полупрозрачная
заливка без размытия).

Правила: цвета — только из `useTheme().c`; касаемые элементы — не меньше 44 pt; у
переключателей и кнопок есть `accessibilityRole` и подписи.
