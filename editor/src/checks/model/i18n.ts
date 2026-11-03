/**
 * The model's findings in words, by code (`problem.model.<code>`, translated as
 * checks/messages.ts translates every finding): the model check's (ports/modelCheck,
 * ./problems.ts), a declaration that doesn't read and a worker that failed. The English
 * text a finding carries is the engine's line (golden-checked); these say the same thing
 * in the interface's words. Every code has its line (./problems.test.ts).
 */

import { defineStrings } from '../../i18n/define';

export default defineStrings({
  ru: {
    'problem.model.bad-declaration': 'объявление модели не читается: {error}',
    'problem.model.bad-path': 'путь модели «{path}» — не путь ресурса Minecraft',
    'problem.model.missing': 'файла модели {path} нет',
    'problem.model.bad-face-index':
      'модель {path}: грань ссылается на вершину, текстурную координату или нормаль, которой нет ({detail}); номера считаются от 1, отрицательные не поддерживаются',
    'problem.model.unreadable': 'модель {path} не читается: {error}',
    'problem.model.no-faces': 'в модели {path} нет ни одной грани',
    'problem.model.bad-library-path': 'модель {path}: путь библиотеки материалов «{library}» — не путь ресурса Minecraft',
    'problem.model.missing-library': 'модель {path}: библиотеки материалов {library} нет',
    'problem.model.unreadable-library': 'модель {path}: библиотека материалов {library} не читается: {error}',
    'problem.model.bad-texture-path': 'модель {path}: путь текстуры материала {material} «{texture}» — не путь ресурса Minecraft',
    'problem.model.missing-texture': 'модель {path}: текстуры {texture} материала {material} нет',
    'problem.model.draws-nothing': 'модель {path} ничего не рисует: ни у одной грани нет материала с текстурой',
    'problem.model.untextured-faces': 'модель {path}: грани без текстуры (map_Kd) не рисуются — материалы {materials}',
    'problem.model.group-too-long':
      'модель {path}: группа управления «{group}» длиннее {limit} знаков и отбрасывается — её переключатели не работают, её свет не горит (с LINVERT — горит всегда)',
    'problem.model.bad-animation-path': 'анимация двери «{door}»: путь «{path}» — не путь ресурса Minecraft',
    'problem.model.missing-animation': 'анимация двери «{door}»: файла {path} нет',
    'problem.model.unreadable-animation': 'анимация двери «{door}»: {path} не читается: {error}',
    'problem.model.livery-replaces-nothing': 'ливрея «{livery}» не заменяет ни одной текстуры (папка {folder} рядом с моделью)',
    'problem.model.failed': 'модель {model} не прочитана: {error}',
  },
  en: {
    'problem.model.bad-declaration': 'the model declaration does not read: {error}',
    'problem.model.bad-path': 'model path “{path}” is not a valid resource location',
    'problem.model.missing': 'model file {path} not found',
    'problem.model.bad-face-index':
      "model {path}: a face refers to a vertex, texture coordinate or normal that isn't there ({detail}); indices count from 1, negative ones aren't supported",
    'problem.model.unreadable': "model {path} can't be read: {error}",
    'problem.model.no-faces': 'model {path} has no faces',
    'problem.model.bad-library-path': 'model {path}: material library path “{library}” is not a valid resource location',
    'problem.model.missing-library': 'model {path}: material library {library} not found',
    'problem.model.unreadable-library': "model {path}: material library {library} can't be read: {error}",
    'problem.model.bad-texture-path': 'model {path}: the texture path “{texture}” of material {material} is not a valid resource location',
    'problem.model.missing-texture': 'model {path}: texture {texture} of material {material} not found',
    'problem.model.draws-nothing': 'model {path} draws nothing: no face has a textured material',
    'problem.model.untextured-faces': "model {path}: faces with no texture (map_Kd) aren't drawn — material(s) {materials}",
    'problem.model.group-too-long':
      "model {path}: control group “{group}” is longer than {limit} characters and is dropped — its switches can't be worked, its lights stay off (an LINVERT one on)",
    'problem.model.bad-animation-path': 'animation of door “{door}”: path “{path}” is not a valid resource location',
    'problem.model.missing-animation': 'animation of door “{door}”: file {path} not found',
    'problem.model.unreadable-animation': "animation of door “{door}”: {path} can't be read: {error}",
    'problem.model.livery-replaces-nothing': 'livery “{livery}” replaces no texture (folder {folder} next to the model)',
    'problem.model.failed': 'model {model} could not be read: {error}',
  },
});
