/**
 * The help's topics (docs/proposals/editor.md §6, M5): where to begin, the scenarios of
 * §2.1–§2.5 as a user goes through them (the replay test/replay/examplePack.ts makes the
 * example pack by the same steps), the markup tools, the tabs, the keys, what the editor
 * does not do, where the format's reference is. Each topic in Russian and English, in the
 * markup of ./markup.ts; the buttons are named by their i18n keys (`[[file.save]]`), so
 * the help says what the interface says. ./help.test.tsx holds both languages together:
 * the same links, the same keys, the same labels, every link to a topic that is there.
 *
 * The keys (`keys`) are the shortcuts the code has today (app/session `installShortcuts`,
 * view3d/viewport, the tools' lists, the tabs and splitters); once the editor's key map
 * (app/keys) lands, this topic is to be drawn from it.
 */

import type { Lang } from '../i18n/define';

export interface HelpTopic {
  /** Lower-case words joined by '-': the target of `[…](#id)`. */
  id: string;
  /** Where the topic is listed: the start, the scenarios, the reference. */
  group: 'start' | 'scenarios' | 'reference';
  title: Readonly<Record<Lang, string>>;
  /** The text, in ./markup.ts. */
  body: Readonly<Record<Lang, string>>;
}

/** The repository's files on GitHub, which the help links to. */
const REPO = 'https://github.com/kalkulator777/RWAT/blob/main';

export const TOPICS: readonly HelpTopic[] = [
  {
    id: 'start',
    group: 'start',
    title: { ru: 'С чего начать', en: 'Where to begin' },
    body: {
      ru: `
Редактор собирает пак RWAT (формат паков 1) без ручного JSON: модели — ваши OBJ из Blender, числа разметки берутся с модели в её кадре, ошибки видны до запуска игры — по тем же правилам, что у мода. Всё работает в браузере и без сети; файлы никуда не уходят.

## Экран
- Слева — **дерево пака**: \`pack.mcmeta\`, вагоны (тип и модель парой по одному id), стили рельсов, имена, ассеты.
- В центре — **3D-вид** открытого вагона в кадре OBJ (перёд — −X, верх — +Y), над ним — камера, отображение и инструменты разметки.
- Справа — **инспектор**: форма выделенного файла по схеме формата и секция включённого инструмента.
- Внизу — вкладки [[checks.title]], [[objects.title]], [[preview.title]], [[names.title]], [[sounds.title]].

## По шагам
1. [Новый пак с нуля](#new-pack): мастер, вагон из своих OBJ, формы.
2. [Открыть существующий пак](#open-pack): папка, zip, восстановление сессии.
3. [Разметить вагон](#markup): пол, двери, кресла.
4. [Настроить локомотив](#locomotive): органы, свет, звуки.
5. [Проверить и сохранить](#check-save).

Справочник: [инструменты разметки](#tools), [вкладки](#tabs), [клавиши](#keys), [чего редактор не делает](#limits), [формат паков](#format).
`,
      en: `
The editor makes an RWAT pack (pack format 1) without writing JSON by hand: the models are your OBJ files from Blender, the markup's numbers are taken from the model in its own frame, and mistakes show before the game starts — by the mod's own rules. It all works in the browser, offline too; no file leaves it.

## The screen
- On the left, the **pack tree**: \`pack.mcmeta\`, the wagons (a type and a model paired by one id), the rail styles, the names, the assets.
- In the middle, the **3D view** of the open wagon in the OBJ frame (front −X, up +Y), with the camera, the display and the markup tools above it.
- On the right, the **inspector**: the form of the selected file, built from the format's schema, and the section of the tool that is on.
- At the bottom, the tabs [[checks.title]], [[objects.title]], [[preview.title]], [[names.title]], [[sounds.title]].

## Step by step
1. [A new pack from scratch](#new-pack): the wizard, a wagon from your OBJ, the forms.
2. [Open a pack](#open-pack): a folder, a zip, the session restored.
3. [Mark up a wagon](#markup): the floor, the doors, the chairs.
4. [Set up a locomotive](#locomotive): controls, lights, sounds.
5. [Check and save](#check-save).

Reference: [the markup tools](#tools), [the tabs](#tabs), [the keys](#keys), [what the editor does not do](#limits), [the pack format](#format).
`,
    },
  },
  {
    id: 'new-pack',
    group: 'scenarios',
    title: { ru: 'Новый пак с нуля', en: 'A new pack from scratch' },
    body: {
      ru: `
1. [[newpack.newPack]]: имя пака (так назовутся папка или zip), пространство имён — строчные латинские буквы, цифры, \`_ . -\` (оно входит в id каждого вагона), и блок \`rwat\`: название, версия, авторы, лицензия, описание. Описание для списка паков Minecraft (\`pack.description\`) правится потом в форме \`pack.mcmeta\`.
2. [[newpack.addWagon]]: id типа, папка модели (если пусто — \`stock/<id>\`), файлы модели — один OBJ и рядом его MTL, PNG и \`.anim\`, — длина, масса, шкворни, название на en и ru. Получается пара: тип \`data/<ns>/wagon_types/<id>.json\` и модель \`assets/<ns>/wagon_models/<id>.json\`. Имена файлов — строчными, без пробелов: иначе Minecraft их не загрузит, и редактор откажет со списком.
3. [[newpack.addFiles]]: то, что лежит не в папке модели, — общие текстуры нескольких моделей (\`assets/<ns>/stock/common\`), папка ливреи рядом с OBJ (\`assets/<ns>/stock/<вагон>/l_<ливрея>\`), README, лицензия и \`pack.png\` в корне пака (папка пустая).
4. Вид показывает модель, вкладка [[objects.title]] — роли её объектов. В инспекторе — форма типа: обязательные поля подсвечены, пустое поле показывает, что возьмёт движок. Форма модели: \`skip\` (префиксы объектов, которые не рисуются, например \`GUIDE_\`), \`liveries\`, \`animations\` (id двери → \`.anim\`), \`handbrake\`, \`sway\`.
5. Пол, двери и кресла — [инструментами разметки](#markup); органы, свет и звуки — [как у локомотива](#locomotive); названия — вкладка [[names.title]].
6. [[newpack.addRail]]: тайл пути — OBJ с MTL и текстурами, шаг \`tile_length\`, название.
7. Тип переименовывают кнопкой [[save.rename.button]] в инспекторе: старый id уходит в \`aliases\`, и вагоны, сохранённые в мирах, не теряются.
8. [[checks.title]] пусты → [сохранить](#check-save).
`,
      en: `
1. [[newpack.newPack]]: the pack's name (the folder's or the zip's), its namespace — lower-case Latin letters, digits, \`_ . -\` (it is part of every wagon's id) — and the \`rwat\` block: name, version, authors, licence, description. The description Minecraft's pack list shows (\`pack.description\`) is edited later in the form of \`pack.mcmeta\`.
2. [[newpack.addWagon]]: the type's id, the model's folder (\`stock/<id>\` when empty), the model's files — one OBJ and, beside it, its MTL, PNG and \`.anim\` files —, the length, the mass, the pivots, the name in en and ru. It makes a pair: the type \`data/<ns>/wagon_types/<id>.json\` and the model \`assets/<ns>/wagon_models/<id>.json\`. File names in lower case without spaces: Minecraft loads no others, and the editor refuses them with a list.
3. [[newpack.addFiles]]: what is not in the model's folder — textures several models share (\`assets/<ns>/stock/common\`), a livery's folder beside the OBJ (\`assets/<ns>/stock/<wagon>/l_<livery>\`), the README, the licence and \`pack.png\` at the pack's root (an empty folder).
4. The view shows the model, the tab [[objects.title]] the roles of its objects. The inspector has the type's form: required fields stand out, an empty field shows what the engine takes. The model's form: \`skip\` (prefixes of objects not drawn, such as \`GUIDE_\`), \`liveries\`, \`animations\` (a door's id → its \`.anim\`), \`handbrake\`, \`sway\`.
5. The floor, the doors and the chairs with [the markup tools](#markup); controls, lights and sounds [as for a locomotive](#locomotive); the names in the tab [[names.title]].
6. [[newpack.addRail]]: a track tile — its OBJ with its MTL and textures, the step \`tile_length\`, a name.
7. A type is renamed with [[save.rename.button]] in the inspector: the old id goes into \`aliases\`, so the wagons saved in worlds are not lost.
8. [[checks.title]] empty → [save](#check-save).
`,
    },
  },
  {
    id: 'open-pack',
    group: 'scenarios',
    title: { ru: 'Открыть существующий пак', en: 'Open a pack' },
    body: {
      ru: `
- [[file.openFolder]] — Chromium (Chrome, Edge): сохранение пишет в саму папку, только изменённые файлы.
- [[file.openZip]] — любой браузер; сохраняется новым zip.
- [[file.openFolderReadonly]] — Firefox и Safari: правки сохраняются zip-ом.

Сразу читаются \`pack.mcmeta\`, декларации и lang-файлы; OBJ и текстуры — когда открывают модель или нажимают [[checks.models.run]].

Пак, собранный конвертером (с \`RWAT_CONVERSION.txt\`), открывается только для просмотра: его правят через рецепт, в режиме [[shell.mode.2b]]. Пак без блока \`rwat\` открывается с предупреждением; пак формата новее 1 — только для просмотра, как его пропустила бы игра.

Несохранённая работа хранится в браузере: открыв редактор снова, можно [[save.restore.restore]] или [[save.restore.discard]].

Находки пака — во вкладке [[checks.title]]; клик по находке ведёт к полю, зоне, двери или креслу, о которых она.
`,
      en: `
- [[file.openFolder]] — Chromium (Chrome, Edge): saving writes into the folder itself, the changed files only.
- [[file.openZip]] — any browser; it is saved as a new zip.
- [[file.openFolderReadonly]] — Firefox and Safari: edits are saved as a zip.

\`pack.mcmeta\`, the declarations and the lang files are read at once; OBJ files and textures when a model is opened or [[checks.models.run]] is pressed.

A pack the converter made (with \`RWAT_CONVERSION.txt\`) opens for viewing only: it is edited through its recipe, in the mode [[shell.mode.2b]]. A pack without the \`rwat\` block opens with a warning; a pack of a format newer than 1 for viewing only, as the game would skip it.

Unsaved work is kept in the browser: when the editor opens again you can [[save.restore.restore]] or [[save.restore.discard]].

The pack's findings are in the tab [[checks.title]]; a click on a finding goes to the field, zone, door or chair it is about.
`,
    },
  },
  {
    id: 'markup',
    group: 'scenarios',
    title: { ru: 'Разметить вагон: пол, двери, кресла', en: 'Mark up a wagon: floor, doors, chairs' },
    body: {
      ru: `
Разметка делается в 3D-виде, в кадре OBJ, как в Blender. Каждое действие мышью можно сделать и числами в инспекторе.

## Пол
[[tools.floor.title]] включает вид сверху. Зона — прямоугольник: протяните мышью из угла в угол; края притягиваются к сетке 1/16 блока, к вершинам модели и к краям других зон, {{Shift}} — новая зона даже вплотную к другой. Высота пола (\`min.y\`) — кнопка [[tools.floor.pick]] и клик по полу модели сбоку или в перспективе — или число. Поверх рисуется, где может стоять игрок, и выходы; двери — закрытыми, открытыми или как в предпросмотре.

## Двери
[[tools.doors.title]]: выделите створку (со своей ручкой) или направляющую проёма — в виде или во вкладке [[objects.title]] — и нажмите [[tools.doors.fromSelection]]; двойной клик по объекту делает то же. Коробку двигают и растягивают на видах сверху, сбоку и спереди. В инспекторе — id (ключи \`animations\` и \`sounds.doors\` модели переименуются вместе с ним), флаги \`inner\`, \`fixed\`, \`connecting\`, группа. Стрелка показывает сторону «наружу».

## Кресла
[[tools.seats.title]]: клик по подушке ставит кресло машиниста в середину её верха ({{Alt}} — в точку клика); поворот — циферблатом, шагом 15° ({{Alt}} — 1°), или кнопками «вперёд» и «назад». Видны круг досягаемости 2.5, высота над полом и кабина.

Находки проверки пола — в секции инструмента и во вкладке [[checks.title]]. Подробнее об инструментах — [справочник](#tools).
`,
      en: `
Markup is made in the 3D view, in the OBJ frame, as in Blender. Whatever the mouse does can be done with numbers in the inspector too.

## The floor
[[tools.floor.title]] turns the view to the top. A zone is a rectangle: drag from corner to corner; its edges snap to the 1/16-block grid, to the model's vertices and to the edges of other zones, {{Shift}} makes a new zone even against another. The floor's height (\`min.y\`) is the button [[tools.floor.pick]] and a click on the model's floor from the side or in perspective — or a number. Over the zones the view draws where a player can stand, and the ways out; with the doors shut, open or as the preview has them.

## The doors
[[tools.doors.title]]: select a leaf (with its handle) or a doorway's guide — in the view or in the tab [[objects.title]] — and press [[tools.doors.fromSelection]]; a double click on an object does the same. The box is moved and stretched from the top, the side and the front. The inspector has the id (the model's \`animations\` and \`sounds.doors\` keys are renamed with it), the flags \`inner\`, \`fixed\`, \`connecting\`, the group. An arrow shows the way out.

## The chairs
[[tools.seats.title]]: a click on a cushion places a driver's chair in the middle of its top ({{Alt}}: at the point clicked); it turns by its dial, 15° a step ({{Alt}}: 1°), or by the forward and back buttons. The reach of 2.5, the height over the floor and the cab are shown.

The floor check's findings are in the tool's section and in the tab [[checks.title]]. More on the tools: [the reference](#tools).
`,
    },
  },
  {
    id: 'locomotive',
    group: 'scenarios',
    title: { ru: 'Настроить локомотив: органы, свет, звуки', en: 'Set up a locomotive: controls, lights, sounds' },
    body: {
      ru: `
## Органы
[[preview.title]] → органы: ползунок ставит то, что ставит машинист — позицию контроллера 0…8, реверсор −1, 0, +1, показание прибора, — и вид двигает орган, как игра. Шарнир, ось и дугу хода показывает инструмент [[tools.pivots.title]]; ось, которая крутит не туда, правится в Blender (маркер \`<KEY>_ROT\`).

Ручник — список \`handbrake\` в форме модели (например, \`WIDGET_1\`); \`HANDBRAKE_<n>\` распознаётся сам.

## Свет
[[preview.title]] → свет: переключатели групп \`LCG\` и [[preview.lights.showLit]] — горит то, что горит в игре. Конусы фар и лампы салона показывает инструмент [[tools.lights.title]]. Название группы — вкладка [[names.title]], [[names.light.legend]]: тип, код группы, как в OBJ (например, \`FHL\`), и текст на каждом языке.

## Звуки
Вкладка [[sounds.title]] открытого вагона: петли \`idle\`, \`wheels\`, \`horn\`, \`bell\` — один звук или \`start\`, \`main\`, \`stop\` с диапазонами \`pitch\` и \`volume\` (кнопка [[sounds.toObject]]); \`clack\`; звуки дверей по их id; звуки органов по ключам ([[sounds.controls.add]]). Ссылка — \`.ogg\` пака или звуковое событие \`minecraft:…\`; у каждого ключа написано, что с ним делает игра и где его слышно. ▶ играет \`.ogg\` пака; звуки самой игры здесь не прослушать.
`,
      en: `
## Controls
[[preview.title]] → controls: a slider sets what the driver sets — the throttle's notch 0…8, the reverser −1, 0, +1, a gauge's reading — and the view moves the control as the game does. The tool [[tools.pivots.title]] shows the hinge, the axis and the arc of travel; an axis that turns the wrong way is mended in Blender (the marker \`<KEY>_ROT\`).

The handbrake is the model's \`handbrake\` list in its form (such as \`WIDGET_1\`); \`HANDBRAKE_<n>\` is found by itself.

## Lights
[[preview.title]] → lights: a switch for each \`LCG\` group and [[preview.lights.showLit]] — what burns in the game burns in the view. The tool [[tools.lights.title]] shows the headlights' cones and the cabin lamps. A group's name is in the tab [[names.title]], [[names.light.legend]]: the type, the group's code as the OBJ spells it (such as \`FHL\`) and the text in each language.

## Sounds
The tab [[sounds.title]] of the open wagon: the loops \`idle\`, \`wheels\`, \`horn\`, \`bell\` — one sound, or \`start\`, \`main\`, \`stop\` with the ranges \`pitch\` and \`volume\` (the button [[sounds.toObject]]); \`clack\`; a sound for each door by its id; the controls' sounds by their keys ([[sounds.controls.add]]). A sound is an \`.ogg\` of the pack or a sound event \`minecraft:…\`; each key says what the game does with it and how far it carries. ▶ plays an \`.ogg\` of the pack; the game's own sounds cannot be played here.
`,
    },
  },
  {
    id: 'check-save',
    group: 'scenarios',
    title: { ru: 'Проверить и сохранить', en: 'Check and save' },
    body: {
      ru: `
## Проверки
Вкладка [[checks.title]] обновляется после каждой правки: схема формата, правила загрузчика мода (геометрия типа, пары тип ↔ модель, файлы, ключи анимаций и звуков), проверка пола, проверки модели. У находки — важность, текст на языке интерфейса и место; клик ведёт туда. [[checks.models.run]] читает по очереди все модели пака, как \`/rwatc packs validate\` в игре.

## Сохранение
[[file.save]] ({{Ctrl+S}}) показывает, что будет записано: новые файлы, изменённые — со счётчиком строк и разницей, удалённые.

- Открытая папка: пишутся только изменённые файлы, и в каждом меняются только изменённые места.
- Zip: новый архив всего пака, неизменённые файлы в нём — те же байты.

Ошибки сохранению не мешают, но загрузчик мода пропустит файлы с ошибками — окно сохранения так и говорит. [[file.undo]] и [[file.redo]] работают и после сохранения.
`,
      en: `
## Checks
The tab [[checks.title]] is up to date after every edit: the format's schema, the mod loader's rules (the type's geometry, the pairs of type and model, the files, the keys of animations and sounds), the floor check, the model's checks. A finding has its severity, its text in the interface's language and its place; a click goes there. [[checks.models.run]] reads every model of the pack in turn, as \`/rwatc packs validate\` does in the game.

## Saving
[[file.save]] ({{Ctrl+S}}) shows what will be written: new files, changed ones with their count of lines and their difference, deleted ones.

- An open folder: only the changed files are written, and in each only the places that changed.
- A zip: a new archive of the whole pack, the unchanged files in it the same bytes.

Errors do not stop a save, but the mod's loader skips the files with errors — the save dialog says so. [[file.undo]] and [[file.redo]] work after a save too.
`,
    },
  },
  {
    id: 'tools',
    group: 'reference',
    title: { ru: 'Инструменты разметки', en: 'The markup tools' },
    body: {
      ru: `
Переключатель над видом; серым — инструмент, который к открытому вагону не подходит. Секция включённого инструмента — в инспекторе над формой.

- [[tools.select]] — без инструмента: клик выделяет объект модели, {{Shift}} — добавляет к выделенному.
- [[tools.floor.title]] — зоны пола \`interior\`: нарисовать, сдвинуть, растянуть за край, высота, порядок.
- [[tools.doors.title]] — \`doors\`: по объектам модели, ручками на трёх видах, числами; флаги и группа.
- [[tools.seats.title]] — кресла машиниста \`cab.seats\`: клик по подушке, циферблат.
- [[tools.lights.title]] — только показ: фары, их цвет и сторона, лампы салона, группы света.
- [[tools.pivots.title]] — только показ: маркер шарнира органа, ось со знаком, дуга хода \`ROT\`, сдвиг \`TL\`.

Находка, кликнутая во вкладке [[checks.title]], включает инструмент того, о чём она. Как ими размечают — [по шагам](#markup).
`,
      en: `
The switch above the view; a tool that does not fit the open wagon is grey. The section of the tool that is on is in the inspector, above the form.

- [[tools.select]] — no tool: a click selects an object of the model, {{Shift}} adds it to the selection.
- [[tools.floor.title]] — the floor zones \`interior\`: draw, move, stretch by an edge, height, order.
- [[tools.doors.title]] — \`doors\`: from the model's objects, by their handles in three views, by numbers; flags and group.
- [[tools.seats.title]] — the driver's chairs \`cab.seats\`: a click on a cushion, the dial.
- [[tools.lights.title]] — shows only: the headlights, their colour and side, the cabin lamps, the light groups.
- [[tools.pivots.title]] — shows only: a control's hinge marker, its signed axis, the arc of its \`ROT\` travel, its \`TL\` slide.

A finding clicked in the tab [[checks.title]] turns on the tool of what it is about. How they mark a wagon up: [step by step](#markup).
`,
    },
  },
  {
    id: 'tabs',
    group: 'reference',
    title: { ru: 'Вкладки', en: 'The tabs' },
    body: {
      ru: `
- [[checks.title]] — находки пака со ссылками на место; [[checks.models.run]].
- [[objects.title]] — объекты модели: имя, роль по соглашению об именах OBJ, ключ органа, группа, флаги, материал; поиск и фильтр. Выделение то же, что в виде.
- [[preview.title]] — двери (ход по \`.anim\` и створки), органы, свет, ливреи, сцепки. В пак ничего не пишет.
- [[names.title]] — названия вагонов, стилей рельсов и групп света на en и ru: lang-файлы пака.
- [[sounds.title]] — звуки открытого вагона, что с ними делает игра, прослушивание \`.ogg\`.

Границы панелей перетаскиваются; раскладка запоминается в браузере.
`,
      en: `
- [[checks.title]] — the pack's findings with links to their places; [[checks.models.run]].
- [[objects.title]] — the model's objects: name, role by the OBJ name conventions, control key, group, flags, material; search and filter. The selection is the view's.
- [[preview.title]] — doors (their travel by \`.anim\` and leaves), controls, lights, liveries, couplers. It writes nothing into the pack.
- [[names.title]] — the names of wagons, rail styles and light groups in en and ru: the pack's lang files.
- [[sounds.title]] — the open wagon's sounds, what the game does with them, listening to \`.ogg\` files.

The panels' borders can be dragged; the layout is remembered in the browser.
`,
    },
  },
  {
    id: 'keys',
    group: 'reference',
    title: { ru: 'Клавиши', en: 'Keys' },
    body: {
      ru: `
- {{Ctrl+Z}} — [[file.undo]], {{Ctrl+Shift+Z}} или {{Ctrl+Y}} — [[file.redo]] (на Mac — с {{⌘}}). В поле ввода работает его собственная отмена.
- {{Ctrl+S}} — окно сохранения.
- 3D-вид: {{7}} — сверху, {{1}} — сбоку, {{3}} — спереди, {{5}} — перспектива; {{Home}} — вся модель, {{.}} — выделенное.
- Списки зон, дверей и кресел: {{Delete}} — удалить выбранное.
- Поле ввода применяет значение по {{Enter}} или когда из него уходят; {{Esc}} отменяет набранное.
- Вкладки — стрелки, {{Home}}, {{End}}; границы панелей — стрелки.
- {{Esc}} закрывает окно.
`,
      en: `
- {{Ctrl+Z}} — [[file.undo]], {{Ctrl+Shift+Z}} or {{Ctrl+Y}} — [[file.redo]] (with {{⌘}} on a Mac). A text box has its own undo.
- {{Ctrl+S}} — the save dialog.
- The 3D view: {{7}} — from the top, {{1}} — from the side, {{3}} — from the front, {{5}} — perspective; {{Home}} — the whole model, {{.}} — the selection.
- The lists of zones, doors and chairs: {{Delete}} — remove the selected one.
- A box takes its value on {{Enter}} or when you leave it; {{Esc}} drops what was typed.
- Tabs — the arrows, {{Home}}, {{End}}; the panels' borders — the arrows.
- {{Esc}} closes a dialog.
`,
    },
  },
  {
    id: 'limits',
    group: 'reference',
    title: { ru: 'Чего редактор не делает', en: 'What the editor does not do' },
    body: {
      ru: `
- **Не правит сгенерированный пак.** Пак конвертера (с \`RWAT_CONVERSION.txt\`) правят через рецепт: режим [[shell.mode.2b]].
- **Не моделлер.** Геометрию, имена объектов и текстуры правят в Blender; редактор их показывает и проверяет.
- **Не распространяет чужое.** Пак, собранный из чужих моделей (MVP — под CC BY-NC-ND 4.0), — только для себя. Делятся рецептом с оверрайдами: в них нет ни одного чужого ассета. Пак-пример — CC0.
- **Не читает чужие форматы сам.** RTM и IR мод не загружает: IR-пак переводится конвертером, в режиме [[shell.mode.2b]].
- **Не играет звуки игры.** События \`minecraft:…\` здесь не прослушать: ассетов Minecraft в редакторе нет.
- **Один пак за раз.** Ссылки на текстуры другого пака (\`ns:путь\`) помечаются как непроверенные.
- **Ничего не отправляет.** Ни сервера, ни аккаунтов, ни телеметрии: файлы остаются в браузере.
- Нет прогулки по вагону (где может стоять игрок — показано без неё) и версии для телефона.
`,
      en: `
- **It does not edit a generated pack.** A pack the converter made (with \`RWAT_CONVERSION.txt\`) is edited through its recipe: the mode [[shell.mode.2b]].
- **It is no modeller.** Geometry, object names and textures are edited in Blender; the editor shows and checks them.
- **It does not hand on what is not yours.** A pack built from others' models (MVP is under CC BY-NC-ND 4.0) is for yourself only. You share the recipe and its overrides: they hold none of the others' assets. The example pack is CC0.
- **It does not read other formats itself.** The mod loads no RTM or IR pack: an IR pack is turned into RWAT by the converter, in the mode [[shell.mode.2b]].
- **It does not play the game's sounds.** Events \`minecraft:…\` cannot be heard here: the editor has none of Minecraft's assets.
- **One pack at a time.** Links to another pack's textures (\`ns:path\`) are marked as not checked.
- **It sends nothing anywhere.** No server, no accounts, no telemetry: the files stay in the browser.
- No walk through the wagon (where a player can stand is shown without it), no phone version.
`,
    },
  },
  {
    id: 'format',
    group: 'reference',
    title: { ru: 'Формат паков', en: 'The pack format' },
    body: {
      ru: `
Поля формата описаны в схеме \`schema/\`; подсказки и умолчания форм — из неё же, на en и ru.

- [Справочник автора пака](${REPO}/docs/pack-format.md) — файлы пака, ключи типа и модели, стили рельсов, соглашение об именах объектов OBJ, имена, звуки.
- [Пак-пример](https://github.com/kalkulator777/RWAT/tree/main/run/rwat_packs/RwatExamplePack) — все возможности формата 1 на своих моделях; редактор собирает его с нуля [по этим шагам](#start).
- [Что пак может задать и где кончается движок](${REPO}/docs/proposals/pack-capabilities.md).
`,
      en: `
The format's fields are described by the schema \`schema/\`; the forms' hints and defaults come from it too, in en and ru.

- [The pack author's reference](${REPO}/docs/pack-format.md) — the pack's files, the keys of a type and a model, rail styles, the OBJ object name conventions, names, sounds.
- [The example pack](https://github.com/kalkulator777/RWAT/tree/main/run/rwat_packs/RwatExamplePack) — every function of format 1 on models of its own; the editor makes it from scratch [by these steps](#start).
- [What a pack can set and where the engine ends](${REPO}/docs/proposals/pack-capabilities.md).
`,
    },
  },
];

/** A topic by its id. */
export function topic(id: string): HelpTopic | undefined {
  return TOPICS.find((t) => t.id === id);
}
