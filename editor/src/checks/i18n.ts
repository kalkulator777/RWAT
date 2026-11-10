import { defineStrings } from '../i18n/define';

/**
 * The findings in words, by code (docs/proposals/editor.md §6.2): `problem.<code>` with the
 * finding's own params. The English text a finding carries is the engine's or the tool's
 * line (golden-checked where ported); these are the interface's wording of the same thing.
 * Every code the checks make has its line here (checks/messages.test.ts).
 */
export default defineStrings({
  ru: {
    'problem.json.number': 'число',
    'problem.json.integer': 'целое число',
    'problem.json.string': 'строка',
    'problem.json.boolean': 'флаг (true/false)',
    'problem.json.array': 'список',
    'problem.json.object': 'объект',
    'problem.json.null': 'null',
    'problem.json.or': ' или ',

    'problem.schema.type': 'ожидается {expected}, а здесь {got}',
    'problem.schema.enum': '{value} — не из списка {allowed}',
    'problem.schema.const': '{value}: должно быть {expected}',
    'problem.schema.minimum': '{value} меньше наименьшего допустимого {limit}',
    'problem.schema.maximum': '{value} больше наибольшего допустимого {limit}',
    'problem.schema.exclusive-minimum': '{value}: должно быть больше {limit}',
    'problem.schema.exclusive-maximum': '{value}: должно быть меньше {limit}',
    'problem.schema.min-length': '{value}: короче {limit, plural, one {# знака} few {# знаков} many {# знаков} other {# знака}}',
    'problem.schema.max-length': '{value}: длиннее {limit, plural, one {# знака} few {# знаков} many {# знаков} other {# знака}}',
    'problem.schema.pattern': '{value} не подходит под шаблон {pattern}',
    'problem.schema.min-items':
      '{count, plural, one {# элемент} few {# элемента} many {# элементов} other {# элемента}}, а нужно не меньше {limit}',
    'problem.schema.max-items':
      '{count, plural, one {# элемент} few {# элемента} many {# элементов} other {# элемента}}, а можно не больше {limit}',
    'problem.schema.required': 'нет обязательного ключа «{key}»',
    'problem.schema.dependent-required': '«{key}» требует ещё «{needs}»',
    'problem.schema.unknown-key': 'незнакомый ключ «{key}»',
    'problem.schema.unknown-key.hint': 'незнакомый ключ «{key}» — может быть, «{nearest}»?',
    'problem.schema.not': 'такая форма не разрешена: {form}',
    'problem.schema.invalid': 'не подходит под схему: {text}',
    'problem.schema.one-of-many': 'подходит сразу под {count} формы, а должно ровно под одну',
    'problem.schema.no-form': 'не подходит ни под одну из разрешённых форм ({forms})',
    'problem.schema.deprecated': 'устаревшая форма: движок её ещё читает, но пишите новую. {note}',
    'problem.schema.reserved': 'зарезервировано — в игре ничего не меняет: {note}',
    'problem.schema.invalid-json': 'файл не JSON: {reason}',

    'problem.pack.in-folder':
      'пак лежит в папке {folder}: мод читает pack.mcmeta только в корне пака и в таком виде его пропустит; открыт из этой папки',
    'problem.pack.broken-json': 'файл не JSON: ошибка {error} в позиции {offset}',

    'problem.loader.resource-path':
      '{file}: Minecraft принимает в пути ресурса только строчные латинские буквы, цифры и _ . - /; этот файл не загрузится',
    'problem.loader.format-too-new': 'формат пака {format} новее, чем читает эта версия RWAT (до {supported}): обновите мод',
    'problem.loader.type-without-model': 'у типа «{id}» нет модели: в игре он рисуется коробкой (объявите её в {model})',
    'problem.loader.model-without-type': 'нет типа «{id}» ({type}): эта модель никогда не рисуется (модель и тип связывает общий id)',
    'problem.loader.bogie-outside': '«bogies[{index}]» = {value} — вне кузова: шкворень должен быть в пределах ±length/2 = ±{half}',
    'problem.loader.bogie-order':
      '«bogies» идут спереди назад, каждый шкворень позади предыдущего: «bogies[{index}]» = {value} не позади «bogies[{previousIndex}]» = {previous}',
    'problem.loader.coupler-outside': '«couplers.{end}» = {value}: по модулю должно быть меньше length/2 = {half}',
    'problem.loader.cab-seat-and-seats': 'в «cab» есть и «seat», и «seats»: перечислите все кресла в «seats»',
    'problem.loader.door-key': 'ключ «{key}» в {section} — не дверь типа {id}, он ничего не делает (двери: {doors})',
    'problem.loader.missing-file': '{ref}: в паке нет файла {file}',
  },
  en: {
    'problem.json.number': 'a number',
    'problem.json.integer': 'a whole number',
    'problem.json.string': 'a string',
    'problem.json.boolean': 'a flag (true/false)',
    'problem.json.array': 'a list',
    'problem.json.object': 'an object',
    'problem.json.null': 'null',
    'problem.json.or': ' or ',

    'problem.schema.type': 'expected {expected}, got {got}',
    'problem.schema.enum': '{value} is not one of {allowed}',
    'problem.schema.const': '{value} must be {expected}',
    'problem.schema.minimum': '{value} is below the minimum {limit}',
    'problem.schema.maximum': '{value} is above the maximum {limit}',
    'problem.schema.exclusive-minimum': '{value} must be greater than {limit}',
    'problem.schema.exclusive-maximum': '{value} must be less than {limit}',
    'problem.schema.min-length': '{value} is shorter than {limit, plural, one {# character} other {# characters}}',
    'problem.schema.max-length': '{value} is longer than {limit, plural, one {# character} other {# characters}}',
    'problem.schema.pattern': "{value} doesn't match the pattern {pattern}",
    'problem.schema.min-items': '{count, plural, one {# item} other {# items}}, at least {limit} needed',
    'problem.schema.max-items': '{count, plural, one {# item} other {# items}}, at most {limit} allowed',
    'problem.schema.required': 'the required key “{key}” is missing',
    'problem.schema.dependent-required': '“{key}” needs “{needs}” too',
    'problem.schema.unknown-key': 'unknown key “{key}”',
    'problem.schema.unknown-key.hint': 'unknown key “{key}” — did you mean “{nearest}”?',
    'problem.schema.not': 'this form is not allowed: {form}',
    'problem.schema.invalid': 'does not match the schema: {text}',
    'problem.schema.one-of-many': 'matches {count} of the forms at once, exactly one is allowed',
    'problem.schema.no-form': 'matches none of the allowed forms ({forms})',
    'problem.schema.deprecated': 'deprecated form: the engine still reads it, but write the new one. {note}',
    'problem.schema.reserved': 'reserved — changes nothing in game: {note}',
    'problem.schema.invalid-json': 'not a JSON file: {reason}',

    'problem.pack.in-folder':
      "the pack sits in the folder {folder}: the mod reads pack.mcmeta at the pack's root only and would skip it as it is; opened from that folder",
    'problem.pack.broken-json': 'not a JSON file: error {error} at offset {offset}',

    'problem.loader.resource-path':
      '{file}: Minecraft takes only lower-case letters, digits and _ . - / in a resource path; this file is not loaded',
    'problem.loader.format-too-new': 'pack format {format} is newer than this version of RWAT reads (up to {supported}): update the mod',
    'problem.loader.type-without-model': 'wagon type “{id}” has no model: it is drawn as a box (declare it in {model})',
    'problem.loader.model-without-type': 'no wagon type “{id}” ({type}): this model is never drawn (a model and its type share the id)',
    'problem.loader.bogie-outside': '“bogies[{index}]” = {value} is outside the body: a pivot must lie within ±length/2 = ±{half}',
    'problem.loader.bogie-order':
      '“bogies” run front to back, each pivot behind the one before: “bogies[{index}]” = {value} is not behind “bogies[{previousIndex}]” = {previous}',
    'problem.loader.coupler-outside': '“couplers.{end}” = {value} must be under length/2 = {half} in size',
    'problem.loader.cab-seat-and-seats': '“cab” has both “seat” and “seats”: list every chair in “seats”',
    'problem.loader.door-key': 'the {section} key “{key}” is no door of wagon type {id}: it does nothing (doors: {doors})',
    'problem.loader.missing-file': '{ref}: there is no file {file} in the pack',
  },
});
