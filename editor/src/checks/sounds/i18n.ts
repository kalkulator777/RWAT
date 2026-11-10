/**
 * The findings about a model's sounds in words, by code (`problem.sound.<code>`, ./problems.ts;
 * translated as checks/messages.ts translates every finding): the same thing the finding's
 * English text says, in the interface's words, from the same params. Every code has its
 * line (./problems.test.ts).
 */

import { defineStrings } from '../../i18n/define';

export default defineStrings({
  ru: {
    'problem.sound.range-reversed':
      '«sounds.{key}.{name}» идёт задом наперёд: [{from}, {to}] — {from} в покое и {to} на полной (звук не растёт, а убывает; так и задумано?)',
    'problem.sound.pitch-clamped': '«sounds.{key}.pitch» = {value}: игра ограничивает высоту звука от {min} до {max}, остальное срезает',
    'problem.sound.volume-negative': '«sounds.{key}.volume» = {value}: отрицательная громкость — тишина',
    'problem.sound.control-unknown': 'ключ «{key}» в sounds.controls не называет орган кабины: он никогда не звучит',
    'problem.sound.control-shadowed':
      'ключ «{key}» в sounds.controls — тот же вид органа ({kind}), что и «{first}» выше: звучит только первый объявленный ключ вида',
    'problem.sound.not-ogg': 'звук «{ref}» — не .ogg: движок читает его как id звукового события, и ничего не играет',
    'problem.sound.event-undefined':
      'звуковое событие {id} не описано в {file}: ничего не играет (событие игры пишется с явным minecraft:)',
  },
  en: {
    'problem.sound.range-reversed':
      '“sounds.{key}.{name}” runs backwards: [{from}, {to}] is {from} at rest and {to} at full (the sound falls instead of rising; is that meant?)',
    'problem.sound.pitch-clamped': '“sounds.{key}.pitch” = {value}: the game limits pitch to {min}–{max} and cuts the rest off',
    'problem.sound.volume-negative': '“sounds.{key}.volume” = {value}: a negative volume is silence',
    'problem.sound.control-unknown': 'the sounds.controls key “{key}” names no cab control: it never sounds',
    'problem.sound.control-shadowed':
      'the sounds.controls key “{key}” is the same kind of control ({kind}) as “{first}” before it: only the first declared key of a kind sounds',
    'problem.sound.not-ogg': 'the sound “{ref}” is not an .ogg file: the engine reads it as a sound event id and nothing plays',
    'problem.sound.event-undefined':
      'the sound event {id} is not defined in {file}: nothing plays (a game event is written with the explicit minecraft:)',
  },
});
