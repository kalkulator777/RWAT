import { useEffect, useRef } from 'preact/hooks';
import { dispatch } from '../../app/session';
import { findings, pack, revision, schema, selection } from '../../app/store';
import type { Link } from '../../core/contracts';
import { parsePointer, formatPointer } from '../../core/json';
import { classify, railNameKey, wagonNameKey } from '../../core/pack';
import { schemaKindOf, type SchemaKind } from '../../core/schema';
import { SchemaForm } from '../../forms';
import { t } from '../../i18n';
import { nameLangs } from '../names/model';
import { NameFields } from '../names/NameInput';

/** The heading of a file's form by its schema. */
const KIND_TITLES: Record<SchemaKind, string> = {
  wagon_type: 'inspector.kind.wagon-type',
  wagon_model: 'inspector.kind.wagon-model',
  rail_model: 'inspector.kind.rail-model',
  pack_mcmeta_rwat: 'inspector.kind.pack-mcmeta',
  recipe: 'inspector.kind.recipe',
  recipe_override: 'inspector.kind.recipe-override',
};

/** The file the selection is about: the first link that names one. */
function selectedFile(links: readonly Link[]): string | undefined {
  for (const link of links) if (link.kind === 'file' || link.kind === 'field') return link.file;
  return undefined;
}

/** Brings the field a selection points at into view and puts the focus in it (a finding clicked in the checks tab). */
function useFocusField(container: { current: HTMLElement | null }, links: readonly Link[]): void {
  useEffect(() => {
    const link = links.find((l) => l.kind === 'field');
    const root = container.current;
    if (link?.kind !== 'field' || root === null) return;
    const fields = [...root.querySelectorAll<HTMLElement>('[data-pointer]')];
    // The field itself, or the nearest field around it that the form shows.
    let segments = parsePointer(link.at);
    let target: HTMLElement | undefined;
    for (;;) {
      const at = formatPointer(segments);
      target = fields.find((el) => el.dataset.pointer === at);
      if (target !== undefined || segments.length === 0) break;
      segments = segments.slice(0, -1);
    }
    if (target === undefined) return;
    target.scrollIntoView?.({ block: 'nearest' });
    target.querySelector<HTMLElement>('input, select, textarea, button')?.focus({ preventScroll: true });
    target.classList.add('field-flash');
    const done = setTimeout(() => target.classList.remove('field-flash'), 1500);
    return () => clearTimeout(done);
  }, [links]);
}

/**
 * The inspector (editor.md §6.1): the form of the file selected in the tree — a wagon
 * type, a wagon model (without the spatial markup: floor, doors and chairs are M4's 3D
 * tools), a rail style, `pack.mcmeta` — built from the schema, with the type's or the
 * style's name in each language on top. A selected finding brings its field into view.
 */
export function InspectorPanel() {
  void revision.value;
  const container = useRef<HTMLDivElement>(null);
  const open = pack.value;
  const links = selection.value;
  useFocusField(container, links);
  if (open === null) return <p class="slot-empty">{t('shell.empty.inspector')}</p>;
  const file = selectedFile(links);
  if (file === undefined) return <p class="slot-empty">{t('inspector.pick')}</p>;
  if (!open.has(file)) return <p class="slot-empty">{t('inspector.gone', { file })}</p>;
  const declaration = classify(file);
  const kind = schemaKindOf(file);
  const id = declaration?.id ?? '';
  const heading = kind === undefined ? (declaration?.kind === 'lang' ? t('inspector.kind.lang') : t('inspector.kind.file')) : t(KIND_TITLES[kind], { id });
  const loaded = schema.value;
  const error = open.jsonError(file);
  let body;
  if (declaration?.kind === 'lang') body = <p class="inspector-note">{t('inspector.lang')}</p>;
  else if (kind === undefined) body = <p class="inspector-note">{t('inspector.noForm')}</p>;
  else if (error !== null) body = <p class="inspector-note">{t('inspector.brokenJson', { detail: error.message })}</p>;
  else if (loaded === null) body = <p class="inspector-note">{t('inspector.schemaLoading')}</p>;
  else {
    const nameKey = kind === 'wagon_type' ? wagonNameKey(id) : kind === 'rail_model' ? railNameKey(id) : undefined;
    const langs = nameLangs(open);
    body = (
      <>
        {nameKey !== undefined && declaration && (
          <NameFields
            nameKey={nameKey}
            namespace={declaration.namespace}
            fallback={id}
            langs={langs}
            values={Object.fromEntries(langs.map((code) => [code, open.names(code).get(nameKey)?.value]))}
          />
        )}
        <SchemaForm
          file={file}
          kind={kind}
          value={open.json(file)}
          schema={loaded}
          problems={findings.value}
          pack={open}
          readOnly={open.readOnly}
          spatialNote
          onCommand={(command) => void dispatch(command)}
        />
      </>
    );
  }
  return (
    <div class="inspector" ref={container} data-testid="inspector" data-file={file} data-kind={kind ?? declaration?.kind ?? 'file'}>
      <header class="inspector-head">
        <h2 class="inspector-title">{heading}</h2>
        <p class="inspector-file">{file}</p>
        {open.readOnly && <p class="inspector-note">{t('inspector.readOnly')}</p>}
      </header>
      {body}
    </div>
  );
}
