# RWAT Example Pack

Пак-пример формата паков RWAT 1 (решение R11 в `docs/roadmap.md`). **Сгенерирован** скриптом
`tools/gen_example_pack.py` — руками не правится: правьте скрипт и запускайте
`python -I tools/gen_example_pack.py`. Тест `tools/tests/test_example_pack.py` следит, чтобы этот
пак совпадал с тем, что пишет скрипт, байт в байт.

Лицензия — **CC0 1.0** (`LICENSE.txt`): модели, текстуры и декларации свои, процедурные, без чужих
ассетов. Звуков в паке нет: модели ссылаются на ванильные звуковые события `minecraft:…`.
Модели нарочно грубые (коробки и цилиндры): пак — справочник для автора, веб-редактора и тестов.

Справочник формата — `docs/pack-format.md`. Вся разметка типов (зоны пола, двери, кресла) — в
**кадре OBJ**, как в Blender: x вдоль вагона, перёд — к −X; y вверх, головка рельса (низ круга
катания) на y = −0.03; z поперёк, +Z — левый борт по ходу. Числа разметки совпадают с вершинами
OBJ. Объекты `GUIDE_*` в OBJ вагона и тепловоза рисуют эту разметку (зоны, проёмы дверей, кресла)
для того, кто откроет модель; в игре их выбрасывает `skip` модели. Где движок пока ведёт себя
иначе, чем говорит формат 1, — раздел 13 справочника.

## Что в паке

| Файл | Что |
|---|---|
| `pack.mcmeta` | секция `pack` Minecraft и блок `rwat`: `format` 1, `name`, `version`, `authors`, `license`, `description` |
| `data/rwat_example/wagon_types/coach.json` | пассажирский вагон, 20 м |
| `data/rwat_example/wagon_types/shunter.json` | маневровый тепловоз, 14 м |
| `data/rwat_example/wagon_types/gondola.json` | двухосный полувагон, 10 м |
| `assets/rwat_example/wagon_models/*.json` | их модели: OBJ, анимация, ливреи, звуки |
| `assets/rwat_example/rail_models/wooden_track.json` | стиль рельсов: тайл 0.75 м |
| `assets/rwat_example/lang/en_us.json`, `ru_ru.json` | имена типов, стиля рельсов и групп света |
| `assets/rwat_example/stock/common/` | общие текстуры: модели берут их через `../common/…` |

## Какие функции формата показывает каждый объект

### Пассажирский вагон `rwat_example:coach`

| Функция | Как сделано |
|---|---|
| геометрия, физика | `length`, `bogies`, `mass_t`, `max_speed_kmh`; `resistance` — только `c` (остальное — умолчания движка); `brakes.system` = `ep` и `parking_kn` |
| тележки | `BOGEY_FRONT` / `BOGEY_REAR` — рамы; `BOGEY_FRONT_WHEEL_1/2`, `BOGEY_REAR_WHEEL_1/2` — колёсные пары: радиус круга катания 0.53, низ на y = −0.03, гребень 0.5625 |
| ходимый салон | `interior`: четыре зоны — передний тамбур (пол 1.15), проход салона и средняя площадка (пол 1.30, перекрываются — сливаются), задний тамбур (1.15) |
| наружные двери | `door_fl`, `door_fr`, `door_rl`, `door_rr` — коробки створок снаружи обшивки; `group` `DoorsL` / `DoorsR` открывает створки одного борта вместе; створки `DOOR_1…4_TL_±0.95_X` уезжают вдоль борта, ручки `DOOR_n_HANDLE` — тот же орган |
| переходные двери | `gangway_front`, `gangway_rear` с `connecting`; створки `DOOR_5_LEAF`, `DOOR_6_LEAF` на шарнирах-маркерах `DOOR_5_ROT_90`, `DOOR_6_ROT_-90` (открываются внутрь тамбура) |
| внутренняя дверь | `salon_door` с `inner` между передним тамбуром и салоном; створка и ручка ходят по `.anim` (`animations` модели, `stock/coach/salon_door.anim`) |
| проём без створки | `salon_arch` с `inner` и `fixed` между задним тамбуром и салоном |
| свет салона | лампы `LAMPS_FULLBRIGHT_LCG_IL` (острова больше 0.3 — лампы салона), детали салона `INTERIOR_*_LCG_IL` (префикс INTERIOR — прячутся вдали, токен INTERIOR — освещаются лампами); выключатель `WIDGET_1_TOGGLE_CG_IL` в переднем тамбуре |
| ручной тормоз | маховик `HANDBRAKE_1` в заднем тамбуре |
| сцепки | `COUPLED_FRONT_1` / `COUPLED_REAR_1` — хвостовик, виден всегда; `…_2_HIDE` — голова расцепленная, `…_3_HIDE_INVERT` — сцепленная; `couplers` −0.05 сводят головы внутрь рам |
| ливрея | `liveries`: `blue` → папка `l_blue/` с `coach_body.png` и `coach_door.png` того же имени |
| звуки | `wheels` (петля объектом: `main`, `pitch`, `volume`), `clack`, `doors` по id дверей |
| прочее | `skip` (`GUIDE_`), `sway` 0.8 |

### Маневровый тепловоз `rwat_example:shunter`

| Функция | Как сделано |
|---|---|
| тяга и тормоза | `traction` (все четыре поля), `brakes` (`system`, `train_kn`, `independent_kn`, `parking_kn`, `apply_s`, `release_s`), `resistance` (все четыре поля) |
| кабина | `cab.seats`: кресло машиниста (`yaw` 0) у переднего пульта и второе кресло у заднего пульта (`yaw` 180 — ведёт в обратную сторону); пол кабины — две касающиеся зоны (Г-образный пол у заднего пульта) |
| подножки | `steps_left`, `steps_right` — проёмы с `fixed` в боковых стенах кабины, снаружи — ступени |
| рукоятки | `THROTTLE_1`, `REVERSER_1`, `TRAIN_BRAKE_1`, `IND_BRAKE_1` и на заднем пульте `THROTTLE_2`, `REVERSER_2`, `TRAIN_BRAKE_2`: у каждой маркер шарнира `<KEY>_ROT_<град>` (линия вдоль оси), рычаг и рукоять |
| приборы | `GAUGE_SPEED_1/2` со стрелкой `…_NEEDLE_RANGE_0_1.5` (полная шкала — 1.5 × `max_speed_kmh` = 90 км/ч), `BRAKE_PRESSURE_1/2`, `GAUGE_TRAIN_BRAKE_1`, `GAUGE_IND_BRAKE_1`, `GAUGE_TEMPERATURE_1` (значения нет — в покое); `GAUGE_THROTTLE_1_TL_-0.72_Z` и `GAUGE_REVERSER_1_TL_0.08_Y` — указатели-ползунки |
| тумблеры | `WIDGET_1…6` с `TOGGLE`, `_CG_<группа>` и `_OFFSET_-0.5` (нарисованы в среднем положении): фары `FHL`, `RHL`, свет кабины `IL`, подсветка пульта `DeskL`; `WIDGET_4`, `WIDGET_5` с `GLOBAL` и `_LABEL_` ставят группы `DoorsL`/`DoorsR` всему поезду — открывают двери вагона |
| кнопки | `HORN_CONTROL_1`, `WHISTLE_CONTROL_1`, `BELL_CONTROL_1` с `PRESS`, `ENGINE_START_1` с `TOGGLE` и `_LABEL_` (ставят значение своей группы; сигналы звучат с клавиш) |
| окно | `WINDOW_1_INVERT_TL_0.8_Y`: стекло нарисовано опущенным, `INVERT` показывает его закрытым в покое |
| ручной тормоз | `HANDBRAKE_1` на задней стене |
| фары | `HEADLIGHT_1_LCG_FHL_0XFFF2CC` спереди, `HEADLIGHT_2_LCG_RHL_0XFFF2CC` сзади; заслонка `WIDGET_7_CG_FHL_HIDE_NOTOUCH` видна, пока фара выключена, и не кликается |
| свет | `CAB_LAMP_FULLBRIGHT_LCG_IL` — лампа кабины; `TAIL_LAMPS_FULLBRIGHT_LCG_REL` — хвостовые без тумблера (только меню света машиниста); циферблаты `DIALS_*_FULLBRIGHT_LCG_DeskL`; `IND_LAMP_FULLBRIGHT_LCG_FHL_LINVERT` горит, пока фара выключена |
| сцепки | `COUPLED_FRONT_n` / `COUPLED_REAR_n` без HIDE — видны всегда; `couplers` +0.05 — головы выступают за раму |
| ливрея | `green` → `l_green/shunter_body.png` |
| звуки | `idle` (`start`, `main`, `stop`, `pitch`, `volume`), `horn` (петля объектом), `bell` (строкой), `wheels`, `clack`, `controls` (`move`, `engage`; `WIDGET_1` принимается и пока молчит) |
| прочее | `skip`, `sway` 0.6 |

### Двухосный полувагон `rwat_example:gondola`

| Функция | Как сделано |
|---|---|
| оси без тележек | `bogies` типа — оси; колёсные пары названы `BOGEY_FRONT_WHEEL_1`, `BOGEY_REAR_WHEEL_1` (так движок их вращает); рам тележек нет, поэтому `bogies` модели заданы явно |
| груз | `CARGO_FILL_1/50/100` — выбрасываются всегда (груза в движке нет) |
| HIDE | `TARP_HIDE` — брезент, выбрасывается при загрузке |
| ручной тормоз | `handbrake` модели объявляет маховиком `WIDGET_1` |
| прочее | `brakes.system` = `freight`, `aliases` (старый id `rwat_example:open_wagon`), звуки строками, `sway` 1.3; `resistance` и `couplers` не заданы — умолчания движка |

### Стиль рельсов `rwat_example:wooden_track`

| Функция | Как сделано |
|---|---|
| тайл | `tile_length` 0.75; `RAIL_LEFT`, `RAIL_RIGHT` — рельсы (головка на z = ±0.8125, верх на y = 0.40625), растягиваются по тайлу |
| основание | `SLEEPER`, `BALLAST` и `RAIL_BASEPLATES` (`RAIL_` с `BASE` — тоже основание) |
| HIDE | `GUIDE_CENTRE_LINE_HIDE` не рисуется и не входит в полотно |

## Чего в паке нет

- `brakes.dynamic_kn`, `brakes.dynamic_fade_kmh` — зарезервированы, не моделируются (загрузчик предупреждает).
- `cab.seat`, `cab.seat_yaw`, `interior` одним объектом — устаревшие формы.
- `THROTTLE_BRAKE_<n>` — орган не работает (нарисован в нейтрали), игроку непонятен.
- Материал без `map_Kd` — такие грани не рисуются, проверка пака предупреждает.
