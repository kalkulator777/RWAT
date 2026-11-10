/**
 * The floor check's findings in words, by code (`problem.floor.<code>`, ./problems.ts;
 * translated as checks/messages.ts translates every finding): the same thing the
 * engine's line says (`FloorFinding.text`, the finding's text and tooltip), from the
 * same params, numbers written as the line writes them. Places and sizes are in the OBJ
 * frame, where the author measured them. Every code has its line (./problems.test.ts).
 */

import { defineStrings } from '../../i18n/define';

export default defineStrings({
  ru: {
    'problem.floor.seats-without-interior': 'в cab.seats есть кресла, а пола (interior) нет: к креслу нужно подойти по полу',
    'problem.floor.floor-too-narrow': 'игроку негде встать на полу: любая его часть уже {player_width}',
    'problem.floor.zone-too-narrow':
      'в зоне {index} игроку негде встать ({size_x} × {size_z}): расширьте её до {player_width} или соедините с зоной пошире',
    'problem.floor.door-too-thick': 'дверь {index} «{id}» толщиной {thickness}: коробка точно по створке?',
    'problem.floor.door-too-narrow': 'дверь {index} «{id}» слишком узкая: через неё не пройти',
    'problem.floor.gangway-not-in-end-wall': 'дверь {index} «{id}» — переходная (connecting), но не в торцевой стене',
    'problem.floor.inner-door-no-floor': 'внутренняя дверь {index} «{id}» не касается пола',
    'problem.floor.inner-door-floor-through':
      'внутренняя дверь {index} «{id}»: пол идёт сквозь её проём — зоны по её сторонам касаются или заходят друг на друга в проёме, и игрок стоит наполовину в закрытой створке; разведите их (любой зазор — стена, открытая дверь перекрывает его)',
    'problem.floor.inner-door-floor-round':
      'внутренняя дверь {index} «{id}»: её стороны — один пол и без неё (пол обходит её или идёт сквозь стену рядом), так что закрытая она не стена',
    'problem.floor.door-not-at-floor-end':
      'дверь {index} «{id}» не там, где кончается пол: через неё не выйти (перед ней, в её пролёте, должен помещаться игрок, а пол — кончаться не дальше {slack} от её внутренней грани)',
    'problem.floor.zones-unreachable':
      'до зон пола {zones} не дойти ни из зоны 0, ни от входа: соедините их (касающиеся зоны соединены), поставьте между ними внутреннюю дверь или дайте им дверь наружу',
    'problem.floor.cab-without-seat': 'в кабине с полом нужно кресло машиниста (cab.seats): управляют ключом только из кресла',
    'problem.floor.seat-not-sittable':
      'кресло cab.seats[{index}] ({x}, {y}, {z}): ближайшее место, где встать, — в {reach} (сесть можно с {sit_reach}), пол там на {height} ниже подушки (нужно {min_height}..{max_height}; место кресла — верх подушки)',
  },
  en: {
    'problem.floor.seats-without-interior': 'cab.seats without an interior: a chair needs a floor to walk to it',
    'problem.floor.floor-too-narrow': 'a player fits nowhere on the floor: every part of it is narrower than {player_width}',
    'problem.floor.zone-too-narrow':
      'zone {index} holds no place a player fits ({size_x} × {size_z}): widen it to {player_width} or join it to a wider zone',
    'problem.floor.door-too-thick': 'door {index} “{id}” is {thickness} thick: is the box the door leaf?',
    'problem.floor.door-too-narrow': 'door {index} “{id}” is too narrow to walk through',
    'problem.floor.gangway-not-in-end-wall': 'door {index} “{id}” is a gangway (connecting) door but not in an end wall',
    'problem.floor.inner-door-no-floor': 'inner door {index} “{id}” touches no floor',
    'problem.floor.inner-door-floor-through':
      'inner door {index} “{id}”: the floor runs through its doorway — the zones on its two sides touch or overlap in it, and a player stands half in the shut leaf; part them (any gap is wall; open, the door bridges it)',
    'problem.floor.inner-door-floor-round':
      'inner door {index} “{id}”: its two sides are one floor without it — the floor runs round it or through the wall beside it, so shut it is no wall',
    'problem.floor.door-not-at-floor-end':
      "door {index} “{id}” isn't where the floor ends: nobody can walk through it (a player must fit in front of it, inside its span, with the floor ending within {slack} of its inner face)",
    'problem.floor.zones-unreachable':
      "floor zones {zones} can't be walked to from zone 0 or a way in: join them (zones that touch join), put an inner door between them, or a door out of them",
    'problem.floor.cab-without-seat': 'a walkable cab needs a driver’s chair (cab.seats): in a cab with a floor the keys drive only from a chair',
    'problem.floor.seat-not-sittable':
      'chair cab.seats[{index}] ({x}, {y}, {z}): the nearest place to stand is {reach} off (sitting reaches {sit_reach}), its floor {height} below the cushion ({min_height}..{max_height}; the seat is the top of the cushion)',
  },
});
