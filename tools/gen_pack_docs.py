#!/usr/bin/env python3
"""gen_pack_docs — the pack author's reference, docs/pack-format.md, from schema/ (roadmap R4).

The schemas are the one source of truth about the pack format: what a field
is, its unit, its default, its range, how far the engine follows it. This
script turns them into the Russian reference — what a pack is, its folders,
the coordinate frames, a table per file, the OBJ name conventions
(schema/obj-conventions.json), the lang keys, minimal examples. The
reference is never edited by hand: change the schema and regenerate.

Usage:
    python -I tools/gen_pack_docs.py            write docs/pack-format.md
    python -I tools/gen_pack_docs.py --check    exit 1 if it is out of date
    python -I tools/gen_pack_docs.py --out FILE write elsewhere

Python 3.9+, standard library only.
"""

import argparse
import json
import re
import sys
from pathlib import Path
from urllib.parse import urldefrag, urljoin

ROOT = Path(__file__).resolve().parent.parent
SCHEMA_DIR = ROOT / "schema"
OUT = ROOT / "docs" / "pack-format.md"
CODE_LINK_BASE = "../src/main/java/com/muzhik17/trainsmod/"  # from docs/

# file schemas in the order the reference describes them: (file, section title)
FILES = [
    ("wagon_type.schema.json", "Тип вагона"),
    ("wagon_model.schema.json", "Модель вагона"),
    ("rail_model.schema.json", "Стиль рельсов"),
    ("pack_mcmeta_rwat.schema.json", "pack.mcmeta"),
    ("recipe.schema.json", "Рецепт конвертера IR → RWAT"),
    ("recipe_override.schema.json", "Оверрайд типа в конвертере"),
]

# schemas shown by name instead of being unfolded: "<file>#<pointer>" → name
NAMED = {
    "common.schema.json#/$defs/vec3": "[x, y, z]",
    "common.schema.json#/$defs/box": "коробка {min, max}",
    "common.schema.json#/$defs/resource_path": "путь к ресурсу",
    "common.schema.json#/$defs/type_id": "id типа",
    "common.schema.json#/$defs/namespace": "неймспейс",
    "common.schema.json#/$defs/lang_code": "код языка",
    "common.schema.json#/$defs/lang_texts": "тексты по языкам",
    "wagon_model.schema.json#/$defs/sound_ref": "звук",
    "wagon_model.schema.json#/$defs/loop": "петля",
    "wagon_model.schema.json#/$defs/range": "[от, до]",
    "recipe.schema.json#/$defs/ir_sound": "звук IR",
    "recipe.schema.json#/$defs/rail_patch": "поля стиля рельсов",
    "recipe_override.schema.json#": "оверрайд типа",
    "recipe_override.schema.json#/$defs/lang_texts": "тексты по языкам",
    "recipe_override.schema.json#/$defs/type_patch": "поля типа вагона",
    "recipe_override.schema.json#/$defs/model_patch": "поля модели вагона",
    "recipe_override.schema.json#/$defs/door_edits": "правки дверей по id",
}

# named schemas that get a table of their own after their file's table: (pointer, title)
EXTRA_TABLES = {
    "wagon_model.schema.json": [("#/$defs/loop/oneOf/1", "Петля, объектная форма")],
}

TYPE_RU = {"string": "строка", "number": "число", "integer": "целое", "boolean": "логическое",
           "object": "объект", "array": "массив", "null": "null"}
SIDE_RU = {"server": "сервер", "client": "клиент", "both": "клиент и сервер"}


# ------------------------------------------------------------------ schemas

class Store:
    def __init__(self, folder):
        self.folder = folder
        self.by_id = {}
        for path in sorted(folder.glob("*.schema.json")):
            schema = json.loads(path.read_text(encoding="utf-8"))
            self.by_id[schema.get("$id", path.name)] = schema
        self.layout = json.loads((folder / "pack-layout.json").read_text(encoding="utf-8"))
        self.conventions = json.loads((folder / "obj-conventions.json").read_text(encoding="utf-8"))
        self.status_label = {s["status"]: s["label-ru"] for s in self.layout["statuses"]}

    def uri(self, name):
        for uri in self.by_id:
            if uri.rsplit("/", 1)[-1] == name:
                return uri
        raise KeyError(name)

    def resolve(self, base, ref):
        """(document uri, subschema, '<file>#<pointer>') that `ref` names from document `base`."""
        target, fragment = urldefrag(urljoin(base, ref))
        node = self.by_id[target]
        for part in (fragment[1:].split("/") if fragment else []):
            part = part.replace("~1", "/").replace("~0", "~")
            node = node[int(part)] if isinstance(node, list) else node[part]
        return target, node, target.rsplit("/", 1)[-1] + "#" + fragment


def merged(store, base, site):
    """(base, schema, ref keys) of a property: the site's keywords over everything its $ref chain says."""
    chain = []
    schema = site
    keys = []
    while isinstance(schema, dict) and "$ref" in schema and len(chain) < 10:
        chain.append(schema)
        base, schema, key = store.resolve(base, schema["$ref"])
        keys.append(key)
    out = dict(schema) if isinstance(schema, dict) else {}
    for layer in reversed(chain):
        out.update({k: v for k, v in layer.items() if k != "$ref"})
    return base, out, keys


# ------------------------------------------------------------------ markdown

TOKEN_SPECIAL = re.compile(r"[_*<>]")


def md(text):
    """Prose for markdown: identifiers, paths and names with _ * < > become code spans."""
    out = []
    for token in re.split(r"(\s+)", text or ""):
        if not token or token.isspace():
            out.append(token)
            continue
        # an unbalanced bracket belongs to the prose around the token ("[−a/2, a/2]")
        lead = re.match(r"^[(«\[]*" if "]" not in token else r"^[(«]*", token).group(0)
        rest = token[len(lead):]
        trail = re.search(r"[).,;:»!?\]]*$" if "[" not in rest else r"[).,;:»!?]*$", rest).group(0)
        core = rest[:len(rest) - len(trail)] if trail else rest
        special = TOKEN_SPECIAL.search(core) or re.match(r"^x-[a-z-]+$", core)
        if core and special and re.search(r"\w", core) and "`" not in core:
            out.append(f"{lead}`{core}`{trail}")
        else:
            out.append(token.replace("<", "&lt;").replace(">", "&gt;"))
    return "".join(out)


def code(text):
    text = str(text)
    fence = "``" if "`" in text else "`"
    return f"{fence}{text}{fence}"


def cell(text):
    return (text or "").replace("\n", " ").strip() or "—"


def table(header, rows):
    """A markdown table; | inside cells (code spans too) is escaped as GFM tables need."""
    lines = ["| " + " | ".join(header) + " |", "|" + "---|" * len(header)]
    for row in rows:
        lines.append("| " + " | ".join(cell(c).replace("|", "\\|") for c in row) + " |")
    return lines


def name_cell(entry):
    """A convention entry's name: its Russian wording if it has one, else the pattern as code."""
    return md(entry["x-name-ru"]) if "x-name-ru" in entry else code(entry["name"])


def slug(title):
    """GitHub's heading anchor."""
    return re.sub(r"[^\w\- ]", "", title.lower()).replace(" ", "-")


def compact_json(value, indent=0, width=88):
    """JSON with two-space indents, a list or object kept on one line while it fits."""
    flat = json.dumps(value, ensure_ascii=False)
    if not isinstance(value, (dict, list)) or not value or len(flat) + indent <= width:
        return flat
    pad = " " * (indent + 2)
    if isinstance(value, list):
        inner = [pad + compact_json(v, indent + 2, width) for v in value]
        return "[\n" + ",\n".join(inner) + "\n" + " " * indent + "]"
    inner = [pad + json.dumps(k, ensure_ascii=False) + ": " + compact_json(v, indent + 2, width)
             for k, v in value.items()]
    return "{\n" + ",\n".join(inner) + "\n" + " " * indent + "}"


def code_link(ref):
    """A code reference → a markdown link into the source tree (tools/… and src/… too):
    'client/X.java#name' (a symbol of the file, as obj-conventions.json points) links the
    file under the label X.java#name; 'client/X.java:12', a line, links that line."""
    path, _, symbol = ref.partition("#")
    path, _, line = path.partition(":")
    target = "../" + path if path.startswith(("tools/", "src/")) else CODE_LINK_BASE + path
    anchor = "#L" + line.split("-")[0] if line else ""
    label = path.rsplit("/", 1)[-1] + ("#" + symbol if symbol else "") + (":" + line if line else "")
    return f"[{label}]({target}{anchor})"


def code_links(refs):
    return ", ".join(code_link(r) for r in refs or [])


def fmt(number):
    return str(int(number)) if isinstance(number, (int, float)) and number == int(number) else str(number)


def match_text(match):
    text = {
        "prefix": "префикс",
        "substring": "подстрока",
        "regex": "выражение",
        "anim": "имя из .anim",
        "material": "материал",
        "control_kind": "вид органа",
        "fallback": "всё остальное",
    }.get(match.get("type"), match.get("type", ""))
    if match.get("regex"):
        text += " " + code(match["regex"])
    if match.get("input") == "normalized":
        text += ", без суффикса копии"
    if match.get("case_insensitive"):
        text += ", без учёта регистра"
    return text


# ------------------------------------------------------------------ field tables

class Tables:
    """Turns one schema into rows: every property, unfolded through objects, lists and maps."""

    def __init__(self, store):
        self.store = store
        self.units = {u["unit"]: u["ru"] for u in store.layout["units"]}
        self.statuses = []  # (file, key, status, note) for the summary of what the engine doesn't do yet

    def type_name(self, base, site, depth=0):
        if depth > 6:
            return "…"
        base, schema, keys = merged(self.store, base, site)
        for key in keys:
            if key in NAMED:
                return NAMED[key] + self.suffix(schema, named=True)
        if "const" in schema:
            return code(json.dumps(schema["const"]))
        if "enum" in schema:
            return " | ".join(code(e) for e in schema["enum"])
        for combo in ("oneOf", "anyOf"):
            if combo in schema:
                names = []
                for branch in schema[combo]:
                    name = self.type_name(base, branch, depth + 1)
                    if branch.get("deprecated"):
                        name += " (устар.)"
                    if name not in names:
                        names.append(name)
                return " или ".join(names)
        kind = schema.get("type")
        if isinstance(kind, list):
            return " или ".join(TYPE_RU.get(k, k) for k in kind)
        if kind == "array":
            items = schema.get("items")
            inner = self.type_name(base, items, depth + 1) if isinstance(items, dict) else ""
            noun = {"число": "чисел", "строка": "строк", "объект": "объектов", "целое": "целых"}.get(inner)
            text = f"массив {noun}" if noun else (f"массив: {inner}" if inner else "массив")
            return text + self.suffix(schema)
        if kind == "object" and "properties" not in schema and isinstance(schema.get("additionalProperties"), dict):
            return "объект: ключ → " + self.type_name(base, schema["additionalProperties"], depth + 1)
        if kind is None and "properties" in schema:
            kind = "object"
        return TYPE_RU.get(kind, "любое") + self.suffix(schema)

    @staticmethod
    def suffix(schema, named=False):
        parts = []
        lo, hi = schema.get("minimum"), schema.get("maximum")
        if lo is not None and hi is not None:
            parts.append(f"{fmt(lo)}…{fmt(hi)}")
        elif lo is not None:
            parts.append(f"≥ {fmt(lo)}")
        elif hi is not None:
            parts.append(f"≤ {fmt(hi)}")
        if "exclusiveMinimum" in schema:
            parts.append(f"> {fmt(schema['exclusiveMinimum'])}")
        if "exclusiveMaximum" in schema:
            parts.append(f"< {fmt(schema['exclusiveMaximum'])}")
        if not named:
            a, b = schema.get("minItems"), schema.get("maxItems")
            if a is not None and a == b:
                parts.append(f"ровно {a}")
            else:
                if a:
                    parts.append(f"≥ {a} эл.")
                if b is not None:
                    parts.append(f"≤ {b} эл.")
        return (", " + ", ".join(parts)) if parts else ""

    def unit(self, schema):
        unit = schema.get("x-unit")
        return self.units.get(unit, unit) if unit else ""

    @staticmethod
    def default(schema, required):
        if required:
            return "**обязателен**"
        if "default" in schema:
            return code(json.dumps(schema["default"], ensure_ascii=False))
        formula = schema.get("x-engine-default-ru") or schema.get("x-engine-default")
        return "движок: " + md(formula) if formula else ""

    def text(self, file, key, schema):
        parts = [md(schema.get("x-description-ru", ""))]
        if schema.get("deprecated"):
            parts.insert(0, "**Устарело.**")
        if schema.get("x-frame") == "obj":
            parts.append("**Кадр OBJ** (раздел «Системы координат»).")
        if schema.get("x-status") in self.store.status_label:
            note = schema.get("x-status-note-ru", "")
            parts.append(f"**{self.store.status_label[schema['x-status']]}:** {md(note)}")
            self.statuses.append((file, key, schema["x-status"], note))
        return " ".join(p for p in parts if p)

    def expandable(self, base, site):
        """(base, schema) of the object with properties a site unfolds into, or None."""
        base, schema, keys = merged(self.store, base, site)
        if any(k in NAMED for k in keys) or "properties" not in schema:
            return None
        return base, schema

    def children(self, base, site, key):
        """(row key prefix, base, object schema, own row?) a property unfolds into."""
        out = []
        base, schema, keys = merged(self.store, base, site)
        if any(k in NAMED for k in keys):
            return out
        if "properties" in schema:
            return [(key, base, schema, False)]
        items = schema.get("items")
        if isinstance(items, dict):
            found = self.expandable(base, items)
            if found:
                out.append((key + "[]", found[0], found[1], True))
        extra = schema.get("additionalProperties")
        if isinstance(extra, dict):
            found = self.expandable(base, extra)
            if found:
                out.append((key + ".<ключ>", found[0], found[1], True))
        for combo in ("oneOf", "anyOf"):
            for branch in schema.get(combo, []):
                if branch.get("type") == "null" or branch.get("deprecated"):
                    continue
                for child in self.children(base, branch, key):
                    if all(child[0] != o[0] for o in out):
                        out.append(child)
        return out

    def rows(self, file, base, schema, prefix="", depth=0):
        required = set(schema.get("required", []))
        for name, site in schema.get("properties", {}).items():
            key = prefix + name
            _, flat, _ = merged(self.store, base, site)
            yield [code(key), self.type_name(base, site), self.unit(flat),
                   self.default(flat, name in required), self.text(file, key, flat)]
            if depth > 6:
                continue
            for child_key, child_base, child, own in self.children(base, site, key):
                if own and child.get("x-description-ru") and child.get("x-description-ru") != flat.get("x-description-ru"):
                    yield [code(child_key), "объект", "", "", self.text(file, child_key, child)]
                yield from self.rows(file, child_base, child, child_key + ".", depth + 1)

    def table(self, file, base, schema):
        return table(["Ключ", "Тип", "Ед.", "По умолчанию", "Описание"], self.rows(file, base, schema))


# ------------------------------------------------------------------ document

def generate(store):
    layout = store.layout
    conv = store.conventions
    label = store.status_label
    tables = Tables(store)
    out = []
    add = out.append

    sections = ["Что такое пак", "Структура папок", "Системы координат", "Как читать таблицы"]
    sections += [title for _, title in FILES[:4]]
    sections += ["Имена объектов OBJ", "Lang-ключи"]
    sections += [title for _, title in FILES[4:]]
    sections += ["Что движок пока делает иначе", "Минимальные примеры"]
    numbered = {title: f"{i}. {title}" for i, title in enumerate(sections, 1)}

    def heading(title):
        add("")
        add(f"## {numbered[title]}")
        add("")

    def link(title):
        return f"[{numbered[title]}](#{slug(numbered[title])})"

    def section_of(schema_file):
        return next(t for n, t in FILES if n == schema_file)

    add("<!-- Generated by tools/gen_pack_docs.py from schema/. Do not edit by hand. -->")
    add("")
    add("# Формат паков RWAT — справочник автора")
    add("")
    add("> **Файл генерируется** скриптом `tools/gen_pack_docs.py` из `schema/` — **не править руками**: "
        "правьте схему и перегенерируйте (`python -I tools/gen_pack_docs.py`). Проверить пак по схеме — "
        "`python -I tools/validate_pack.py <пак>`.")
    add("")
    add(f"Описан **формат {layout['format']}** (v1). До заморозки v1 с первым выпуском редактора формат ещё "
        "может меняться (R5). Где движок пока ведёт себя иначе, чем говорит формат, стоят пометки "
        f"«{label['pending-engine']}» и «{label['reserved']}»; все они собраны в разделе "
        + link("Что движок пока делает иначе") + ".")
    add("")
    add("**Содержание**")
    add("")
    for title in sections:
        add(f"- {link(title)}")

    # 1. what a pack is
    heading("Что такое пак")
    add(md(layout["x-description-ru"]))
    add("")
    for item in layout["loading"]:
        add(f"- {md(item['ru'])}")

    # 2. folders
    heading("Структура папок")
    add("```")
    add("<пак>/")
    for f in layout["files"]:
        add("  " + f["path"])
    add("```")
    add("")
    rows = []
    for f in layout["files"]:
        schema = f.get("schema")
        where = f"{code('schema/' + schema)}, {link(section_of(schema))}" if schema else ""
        rows.append([code(f["path"]), SIDE_RU.get(f["side"], f["side"]),
                     code(f["id"]) if f.get("id") else "", md(f["ru"]), where])
    out.extend(table(["Файл", "Сторона", "id", "Что", "Схема"], rows))
    add("")
    add("Файлы инструментов (не входят в пак):")
    add("")
    for f in layout["tooling_files"]:
        add(f"- {code(f['path'])} — {md(f['ru'])} Схема {code('schema/' + f['schema'])}, "
            f"{link(section_of(f['schema']))}.")

    # 3. frames
    heading("Системы координат")
    conversion = layout["frame_conversion"]
    for frame in layout["frames"]:
        add(f"**{frame['x-name-ru']}** (`{frame['id']}`). {md(frame['ru'])}")
        add("")
        for axis in ("x", "y", "z"):
            add(f"- {axis.upper()} — {md(frame['x-axes-ru'][axis])};")
        add(f"- начало — {md(frame['x-origin-ru'])}; единица — блок (= 1 м).")
        if frame.get("x-status") in label:
            add("")
            add(f"**{label[frame['x-status']]}:** {md(frame['x-status-note-ru'])}")
        add("")
    add("**Пересчёт** — для тех, кто переводит файлы, написанные до формата 1. "
        f"Подъём {fmt(conversion['y_lift'])} = {md(conversion['x-y_lift_formula-ru'])}.")
    add("")
    out.extend(table(["Из кадра OBJ в старый", "Из старого в кадр OBJ"],
                     [[code(f"{a} = {conversion['obj_to_legacy'][a]}"),
                       code(f"{a}_obj = {conversion['legacy_to_obj'][a]}")] for a in ("x", "y", "z")]))
    add("")
    add(f"- {md(conversion['x-boxes-ru'])}")
    add(f"- {md(conversion['x-angles-ru'])}")
    add(f"- {md(conversion['x-along_track-ru'])}")
    example = conversion["example"]
    add(f"- Пример — дверь тамбура плацкарта: в старом кадре {code(json.dumps(example['legacy']))}, "
        f"в кадре OBJ {code(json.dumps(example['obj']))}.")

    # 4. legend
    heading("Как читать таблицы")
    add("- **Ключ** — путь к полю: `brakes.train_kn` — поле внутри объекта, `doors[].id` — поле каждого "
        "элемента списка, `controls.<ключ>.move` — поле каждого значения словаря.")
    add("- **По умолчанию** — что движок берёт, если ключа нет: константа или формула («движок: …»). "
        "Пропущенное поле — значение движка, явный `0` — ноль. JSON `null` в паке не пишут; в оверрайдах "
        "конвертера `null` удаляет поле.")
    add("- **Незнакомый ключ** — ошибка схемы (`additionalProperties: false`): опечатку вроде `mass` вместо "
        "`mass_t` ловит валидатор. Исключения: `pack.mcmeta`, где остальные ключи принадлежат Minecraft, и "
        "ключи на `_` в рецепте конвертера и его оверрайдах — это комментарии, на любом уровне.")
    add("")
    add("Пометки:")
    add("")
    for status in layout["statuses"]:
        add(f"- **{status['label-ru']}** (`x-status: {status['status']}`) — {md(status['ru'])}")
    add("- **Устарело** (`deprecated`) — старая форма, движок её ещё читает; пишите новую.")
    add("- **Кадр OBJ** (`x-frame: obj`) — координаты в кадре OBJ, см. " + link("Системы координат") + ".")
    add("")
    standard = [k for k in layout["keywords"] if not k["keyword"].startswith("x-")]
    own = [k for k in layout["keywords"] if k["keyword"].startswith("x-")]
    add("Ключевые слова схем. Стандартные JSON Schema: "
        + "; ".join(f"{code(k['keyword'])} — {md(k['ru'][0].lower() + k['ru'][1:]).rstrip('.')}" for k in standard)
        + ". Свои, с префиксом `x-`:")
    add("")
    for keyword in own:
        add(f"- {code(keyword['keyword'])} — {md(keyword['ru'][0].lower() + keyword['ru'][1:])}")
    add("")
    add("Единицы: " + ", ".join(f"{code(u['unit'])} — {u['ru']}" for u in layout["units"]) + ".")

    def file_section(name, title):
        heading(title)
        uri = store.uri(name)
        schema = store.by_id[uri]
        add(f"Схема {code('schema/' + name)}. Код: {code_links(schema.get('x-code'))}.")
        add("")
        add(md(schema.get("x-description-ru", "")))
        add("")
        out.extend(tables.table(name, uri, schema))
        for pointer, extra_title in EXTRA_TABLES.get(name, []):
            base, sub, _ = store.resolve(uri, pointer)
            add("")
            add(f"**{extra_title}.** {md(sub.get('x-description-ru', ''))}".rstrip())
            add("")
            out.extend(tables.table(name, base, sub))

    for name, title in FILES[:4]:
        file_section(name, title)

    # OBJ conventions
    heading("Имена объектов OBJ")
    roles = {r["id"]: r for r in conv["roles"]}
    naming = conv["naming"]
    add(md(conv["x-description-ru"]) + f" Данные — {code('schema/obj-conventions.json')}.")
    add("")
    add(f"- **Имя объекта.** {md(naming['object_name']['x-description-ru'])}")
    add(f"- **Суффикс копии** {code(naming['copy_suffix']['regex'])}. {md(naming['copy_suffix']['x-description-ru'])}")
    add(f"- **Флаг-токен** {code(naming['token']['regex_template'])}. {md(naming['token']['x-description-ru'])}")
    add("- Регулярные выражения ниже ищутся в имени (поиск, а не полное совпадение), если не привязаны к "
        "началу `^`; они одинаково работают в Java, JavaScript и Python.")
    add("")
    add(f"**Порядок разбора.** {md(conv['parse_order']['x-description-ru'])} "
        f"({code_links(conv['parse_order']['code'])})")
    add("")
    for i, step in enumerate(conv["parse_order"]["steps"], 1):
        add(f"{i}. {name_cell(roles[step])} (`{step}`)")
    add("")
    add("**Роли объектов**")
    add("")
    out.extend(table(["Имя", "Совпадение", "Что делает", "Код"],
                     [[name_cell(r), match_text(r["match"]), md(r["x-description-ru"]), code_links(r.get("code"))]
                      for r in conv["roles"]]))
    add("")
    add(f"**Органы управления.** {md(conv['control_kind_order']['x-description-ru'])} Выражение каждого вида — "
        "`(?:^|_)(<ВИД>)_(\\d+)(?=_|$)`, ключ органа — `<ВИД>_<n>`; все объекты с одним ключом — один орган.")
    add("")
    out.extend(table(["Вид", "Имя", "Класс", "Что делает", "Код"],
                     [[code(k["kind"]), md(k["name"]), code(k["class"]), md(k["x-description-ru"]),
                       code_links(k.get("code"))] for k in conv["control_kinds"]]))
    add("")
    add("Классы органов:")
    add("")
    for c in conv["control_classes"]:
        add(f"- {code(c['class'])} — {md(c['x-description-ru'])}")
    add("")
    add("**Модификаторы органа** (читаются с любого объекта органа):")
    add("")
    out.extend(table(["Модификатор", "Выражение", "Без него", "Что делает", "Код"],
                     [[code(m["name"]), code(m["regex"]), md(m.get("x-default-ru", m.get("default", ""))),
                       md(m["x-description-ru"]),
                       code_links(m.get("code"))] for m in conv["control_modifiers"]]))
    add("")
    add("**Флаги органа** (токены):")
    add("")
    out.extend(table(["Флаг", "Что делает", "Код"],
                     [[" / ".join(code(n) for n in [f["flag"]] + f.get("aliases", [])), md(f["x-description-ru"]),
                       code_links(f.get("code"))] for f in conv["control_flags"]]))
    add("")
    add("**Свет** (на любом текстурированном объекте):")
    add("")
    out.extend(table(["Имя", "Выражение", "Что делает", "Код"],
                     [[name_cell(x), code(x["regex"]), md(x["x-description-ru"]), code_links(x.get("code"))]
                      for x in conv["lights"]]))
    add("")
    add("**Тайл рельсов** (OBJ стиля рельсов):")
    add("")
    out.extend(table(["Имя", "Совпадение", "Что делает", "Код"],
                     [[name_cell(r), match_text(r["match"]), md(r["x-description-ru"]), code_links(r.get("code"))]
                      for r in conv["rail_tile"]]))
    add("")
    add("**Что читает только конвертер** (`tools/ir2rwat.py`; движок эти имена не разбирает):")
    add("")
    out.extend(table(["Имя", "Выражение", "Что делает", "Код"],
                     [[name_cell(r), code(r["regex"]), md(r["x-description-ru"]), code_links(r.get("code"))]
                      for r in conv["converter"]]))
    add("")
    add(f"**{md(conv['ir_static']['x-description-ru']).rstrip('.')}:**")
    add("")
    for n in conv["ir_static"]["names"]:
        add(f"- {code(n['name'])} — {md(n['x-description-ru'])}")
    add("")
    add("**Пределы, зашитые в движок:**")
    add("")
    out.extend(table(["Что", "Значение", "Код"],
                     [[md(x["x-description-ru"]), fmt(x["value"]), code_links(x.get("code"))] for x in conv["limits"]]))

    # lang keys
    heading("Lang-ключи")
    add("Lang-файлы пака — `assets/<namespace>/lang/<язык>.json` (`en_us`, `ru_ru`, …), обычные файлы Minecraft.")
    add("")
    out.extend(table(["Ключ", "Что называет", "Код"],
                     [[code(k["key"]), md(k["ru"]), code_links(k.get("code"))] for k in layout["lang_keys"]]))
    add("")
    groups = layout["mod_light_groups"]
    add(f"{md(groups['ru']).rstrip('.')}: " + ", ".join(code(g) for g in groups["groups"]) + ".")
    add("")
    add(md(layout["not_translated"]["ru"]))

    for name, title in FILES[4:]:
        file_section(name, title)

    # statuses
    heading("Что движок пока делает иначе")
    add("Собрано из пометок схем: поля, которые движок разбирает, но не моделирует, и места, где формат 1 "
        "описывает поведение после ближайших волн карты, а движок пока ведёт себя иначе.")
    add("")
    seen = set()
    for status in ("pending-engine", "reserved"):
        for file, key, s, note in tables.statuses:
            if s != status or key in seen or file == "recipe_override.schema.json":
                continue  # the override's fields repeat the type's
            seen.add(key)
            add(f"- {code(key)} ({file.split('.')[0]}) — **{label[status]}:** {md(note)}")

    # examples
    heading("Минимальные примеры")
    for name, title in FILES:
        schema = store.by_id[store.uri(name)]
        examples = schema.get("examples", [])
        for i, example in enumerate(examples):
            what = "пример" if len(examples) == 1 else "минимум" if i == 0 else "побольше"
            add(f"**{title} — {what}** ({code(schema.get('x-file', name))}):")
            add("")
            add("```json")
            add(compact_json(example))
            add("```")
            add("")
    while out and out[-1] == "":
        out.pop()
    return "\n".join(out) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--check", action="store_true", help="exit 1 if the reference is out of date")
    parser.add_argument("--out", default=str(OUT), help="where to write (default docs/pack-format.md)")
    parser.add_argument("--schema-dir", default=str(SCHEMA_DIR))
    args = parser.parse_args()
    text = generate(Store(Path(args.schema_dir)))
    out = Path(args.out)
    if args.check:
        current = out.read_text(encoding="utf-8") if out.exists() else ""
        if current != text:
            print(f"{out} is out of date: run python -I tools/gen_pack_docs.py")
            sys.exit(1)
        print(f"{out} is up to date")
        return
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text, encoding="utf-8", newline="\n")
    print(f"wrote {out} ({len(text.splitlines())} lines)")


if __name__ == "__main__":
    main()
