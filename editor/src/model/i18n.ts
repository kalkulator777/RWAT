/**
 * Strings of the model pipeline: the findings of a model that can't be read (./build.ts)
 * or that the worker failed to read (app/openModel.ts), translated by their code as
 * checks/messages.ts translates every finding.
 */

import { defineStrings } from '../i18n/define';

export default defineStrings({
  ru: {
    'problem.model.bad-declaration': 'объявление модели не читается: {error}',
    'problem.model.bad-path': 'путь модели «{path}» — не путь ресурса Minecraft',
    'problem.model.missing': 'файла модели {path} нет',
    'problem.model.unreadable': 'модель {path} не читается: {error}',
    'problem.model.failed': 'модель {model} не прочитана: {error}',
  },
  en: {
    'problem.model.bad-declaration': 'the model declaration does not read: {error}',
    'problem.model.bad-path': "model path '{path}' is not a valid resource location",
    'problem.model.missing': 'model file {path} not found',
    'problem.model.unreadable': "model {path} can't be read: {error}",
    'problem.model.failed': 'model {model} could not be read: {error}',
  },
});
