import { defineStrings } from '../../i18n/define';

export default defineStrings({
  ru: {
    'iodev.title': 'Ввод-вывод (временно)',
    'iodev.openZip': 'Открыть zip',
    'iodev.openFolder': 'Открыть папку для чтения',
    'iodev.openFs': 'Открыть папку для записи',
    'iodev.saveZip': 'Скачать zip',
    'iodev.status':
      '{name} ({kind}): {count, plural, one {# файл} few {# файла} many {# файлов} other {# файла}}, {bytes} байт',
  },
  en: {
    'iodev.title': 'I/O (temporary)',
    'iodev.openZip': 'Open zip',
    'iodev.openFolder': 'Open folder (read-only)',
    'iodev.openFs': 'Open folder (read and write)',
    'iodev.saveZip': 'Download zip',
    'iodev.status': '{name} ({kind}): {count, plural, one {# file} other {# files}}, {bytes} bytes',
  },
});
