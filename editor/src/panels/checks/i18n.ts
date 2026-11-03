import { defineStrings } from '../../i18n/define';

export default defineStrings({
  ru: {
    'checks.title': 'Проверки',
    'checks.noPack': 'Пак не открыт.',
    'checks.none': 'Находок нет.',
    'checks.summary': 'Ошибок: {errors}, предупреждений: {warnings}, сведений: {infos}.',
    'checks.severity.error': 'Ошибка',
    'checks.severity.warning': 'Предупреждение',
    'checks.severity.info': 'Сведение',
    'checks.schemaLoading': 'Схема формата загружается: пока есть только проверки загрузки.',
    'checks.schemaFailed': 'Схему формата загрузить не удалось, проверок по схеме нет: {detail}',
    'checks.filter': 'Какие находки показывать',
    'checks.filter.error': 'Ошибки: {count}',
    'checks.filter.warning': 'Предупреждения: {count}',
    'checks.filter.info': 'Сведения: {count}',
  },
  en: {
    'checks.title': 'Checks',
    'checks.noPack': 'No pack open.',
    'checks.none': 'No findings.',
    'checks.summary': 'Errors: {errors}, warnings: {warnings}, notes: {infos}.',
    'checks.severity.error': 'Error',
    'checks.severity.warning': 'Warning',
    'checks.severity.info': 'Note',
    'checks.schemaLoading': 'The format schema is loading: only the loader checks so far.',
    'checks.schemaFailed': 'The format schema did not load, so there are no schema checks: {detail}',
    'checks.filter': 'Which findings to show',
    'checks.filter.error': 'Errors: {count}',
    'checks.filter.warning': 'Warnings: {count}',
    'checks.filter.info': 'Notes: {count}',
  },
});
