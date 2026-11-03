import { defineStrings } from '../i18n/define';

export default defineStrings({
  ru: {
    'io.error.unsafe-path': 'Недопустимые пути (выходят за пак или не пути): {paths}',
    'io.error.duplicate-path': 'Один путь встречается дважды: {paths}',
    'io.error.not-found': 'Нет файла: {paths}',
    'io.error.bad-zip': 'Не удалось прочитать zip: {detail}',
    'io.error.permission-denied': 'Нет доступа к папке. Разрешите доступ в диалоге браузера.',
    'io.error.unsupported': 'Так открыть пак нельзя: {detail}',
    'io.error.io': 'Ошибка чтения или записи: {detail}',
  },
  en: {
    'io.error.unsafe-path': 'Unsafe paths (they leave the pack or are not paths): {paths}',
    'io.error.duplicate-path': 'The same path appears twice: {paths}',
    'io.error.not-found': 'No such file: {paths}',
    'io.error.bad-zip': 'Cannot read the zip: {detail}',
    'io.error.permission-denied': 'No access to the folder. Allow it in the browser dialog.',
    'io.error.unsupported': 'The pack cannot be opened this way: {detail}',
    'io.error.io': 'Read or write error: {detail}',
  },
});
