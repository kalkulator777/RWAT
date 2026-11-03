/**
 * Strings of the model pipeline: the findings of a model that can't be read (./build.ts),
 * translated by their code as checks/messages.ts translates every finding.
 */

import { defineStrings } from '../i18n/define';

export default defineStrings({
  ru: {
    'problem.model.bad-declaration': 'объявление модели не читается: {error}',
    'problem.model.bad-path': 'путь модели «{path}» — не путь ресурса Minecraft',
    'problem.model.missing': 'файла модели {path} нет',
    'problem.model.unreadable': 'модель {path} не читается: {error}',
  },
  en: {
    'problem.model.bad-declaration': 'the model declaration does not read: {error}',
    'problem.model.bad-path': "model path '{path}' is not a valid resource location",
    'problem.model.missing': 'model file {path} not found',
    'problem.model.unreadable': "model {path} can't be read: {error}",
  },
});
