import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { pack, revision, selection } from '../../app/store';
import type { Link } from '../../core/contracts';
import { catalog, lang, t } from '../../i18n';
import { roleColorCss } from '../../view3d/roleColors';
import { explainObject, type Explanation } from './explain';
import type { BuiltModel } from './buildModel';
import {
  NO_FILTER,
  SORT_KEYS,
  buildRows,
  filterRows,
  groupOf,
  roleCounts,
  rolesPresent,
  sortRows,
  type ObjectRow,
  type SortDirection,
  type SortKey,
} from './model';
import { declarationKey, loadWagonModel, stockIdOf, workerModel, type ModelFailure } from './source';
import './objects.css';

/** Rows drawn at once; a model of thousands of objects shows the rest on request. */
export const ROW_LIMIT = 500;

/** The role's name in the interface language, or its id for a role the strings do not know. */
export function roleLabel(role: string): string {
  void lang.value;
  return catalog.get(lang.value, `objects.role.${role.replaceAll('_', '-')}`) ?? role;
}

function RoleMark(props: { role: string }) {
  return (
    <span class="objects-role">
      <span class="objects-swatch" style={{ background: roleColorCss(props.role) }} aria-hidden="true" />
      {roleLabel(props.role)}
    </span>
  );
}

function failureText(failure: ModelFailure): string {
  switch (failure.failure) {
    case 'no-model':
      return t('objects.failure.noModel');
    case 'no-obj':
      return t('objects.failure.noObj', { path: failure.path });
    case 'bad-obj':
      return t('objects.failure.badObj', { detail: failure.detail });
  }
}

type Loaded = { key: string; built: BuiltModel } | { key: string; failure: ModelFailure } | null;

/** The links of the selection that point at objects of this model, by object name. */
function selectedNames(links: readonly Link[], model: string): string[] {
  return links.flatMap((link) => (link.kind === 'object' && link.model === model ? [link.name] : []));
}

function Detail(props: { name: string | null; row: ObjectRow | undefined; skip: readonly string[]; extra: number }) {
  const { name, row, skip, extra } = props;
  if (name === null) return <p class="objects-hint">{t('objects.detail.none')}</p>;
  if (row === undefined) return <p class="objects-hint">{t('objects.detail.outside', { name })}</p>;
  const why: Explanation = explainObject(row.name, row.role, { skip, lang: lang.value });
  return (
    <div class="objects-why" data-testid="objects-why" data-role={row.role}>
      <p class="objects-why-name">{row.name}</p>
      {extra > 0 && <p class="objects-hint">{t('objects.detail.many', { count: extra + 1 })}</p>}
      <p>
        <RoleMark role={row.role} />
        {why.rule !== null && <span class="objects-rule"> · {t('objects.detail.rule', { rule: why.rule })}</span>}
      </p>
      {why.rule === null && <p class="objects-hint">{t('objects.detail.unknownRole', { role: row.role })}</p>}
      <p data-testid="objects-how">
        {why.how === 'unknown' ? null : why.matched !== null ? t(`objects.how.${why.how}`, { matched: why.matched }) : t(`objects.how.${why.how}`, { matched: '' })}
        {why.input === 'normalized' && ` ${t('objects.input.normalized')}`}
      </p>
      {why.effect !== '' && <p class="objects-effect">{why.effect}</p>}
      {why.engine === 'dropped' && <p class="objects-dropped">{t('objects.detail.dropped')}</p>}
      {why.kind !== null && (
        <p>
          <strong>{t('objects.detail.kind', { kind: why.kind.label })}</strong> {why.kind.effect}
        </p>
      )}
      {why.marks.length > 0 && (
        <>
          <h4 class="objects-subhead">{t('objects.detail.marks')}</h4>
          <ul class="objects-marks" data-testid="objects-marks">
            {why.marks.map((mark) => (
              <li key={`${mark.group}:${mark.id}`} data-mark={mark.id}>
                <code>{mark.matched}</code> <span class="objects-kind">({t(`objects.mark.${mark.group}`)}, {mark.label})</span> {mark.effect}
              </li>
            ))}
          </ul>
        </>
      )}
      {why.code.length > 0 && (
        <details class="objects-code">
          <summary>{t('objects.detail.code')}</summary>
          <ul>
            {why.code.map((ref) => (
              <li key={ref}>
                <code>{ref}</code>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/**
 * The "Objects" tab (editor.md §6.1, §3.8): the objects of the selected wagon's model as a
 * table — name, role, control key, group, flags, material, texture, faces — with a search,
 * a legend of the roles in the colours of the 3D view (view3d/roleColors), which is also
 * the role filter, sorting by column, and beside it why the chosen object has its role:
 * the rule of schema/obj-conventions.json that took it, in the interface language.
 *
 * The selection is the editor's one `selection` signal: a click on a row writes the
 * object's link there (Shift or Ctrl adds or removes), and objects the 3D view or the
 * checks select light up their rows.
 */
export function ObjectsPanel() {
  void revision.value;
  const open = pack.value;
  const stock = open === null ? [] : open.stock().filter((entry) => entry.model !== null);
  const fromSelection = stockIdOf(selection.value, stock);

  const [chosen, setChosen] = useState<string | null>(null);
  useEffect(() => {
    if (fromSelection !== null) setChosen(fromSelection);
  }, [fromSelection]);
  const wagon = stock.find((entry) => entry.id === (fromSelection ?? chosen)) ?? (stock.length === 1 ? stock[0] : undefined);

  // the model: the worker's if it has one for this wagon, else the pack's OBJ read here
  const supplied = workerModel.value;
  const useSupplied = supplied !== null && wagon !== undefined && supplied.model.id === wagon.id;
  const key = open !== null && wagon !== undefined ? `${wagon.id}\n${declarationKey(open, wagon)}` : '';
  const [loaded, setLoaded] = useState<Loaded>(null);
  useEffect(() => {
    if (open === null || wagon === undefined || useSupplied) return;
    let current = true;
    void loadWagonModel(open, wagon).then((result) => {
      if (current) setLoaded('built' in result ? { key, built: result.built } : { key, failure: result });
    });
    return () => {
      current = false;
    };
  }, [open, key, useSupplied]);

  const built: BuiltModel | null = useSupplied ? supplied : loaded !== null && loaded.key === key && 'built' in loaded ? loaded.built : null;
  const failure: ModelFailure | null = !useSupplied && loaded !== null && loaded.key === key && 'failure' in loaded ? loaded.failure : null;

  const rows = useMemo(() => (built === null ? [] : buildRows(built.model, built.texturedMaterials)), [built]);
  const counts = useMemo(() => roleCounts(rows), [rows]);
  const present = useMemo(() => rolesPresent(rows), [rows]);

  const [text, setText] = useState('');
  const [pressed, setPressed] = useState<ReadonlySet<string>>(new Set());
  const [lit, setLit] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({ key: 'file', direction: 'asc' });
  const [all, setAll] = useState(false);

  const shown = useMemo(
    () => sortRows(filterRows(rows, { ...NO_FILTER, text, roles: pressed.size === 0 ? null : pressed, lit }), sort.key, sort.direction),
    [rows, text, pressed, lit, sort],
  );
  const drawn = all ? shown : shown.slice(0, ROW_LIMIT);

  const modelId = built?.model.id ?? '';
  const names = selectedNames(selection.value, modelId);
  const chosenSet = new Set(names);
  const tableRef = useRef<HTMLDivElement>(null);
  const firstName = names[0] ?? null;
  useEffect(() => {
    if (firstName === null) return;
    const row = [...(tableRef.current?.querySelectorAll<HTMLElement>('tr[data-object]') ?? [])].find((tr) => tr.dataset.object === firstName);
    row?.scrollIntoView?.({ block: 'nearest' });
  }, [firstName, shown]);

  if (open === null) {
    return <p class="slot-empty">{t('objects.noPack')}</p>;
  }

  const pick = (row: ObjectRow, add: boolean): void => {
    const link: Link = { kind: 'object', model: modelId, name: row.name };
    if (!add) {
      selection.value = [link];
      return;
    }
    const others = selection.value.filter((item) => !(item.kind === 'object' && item.model === modelId && item.name === row.name));
    selection.value = others.length === selection.value.length ? [...selection.value, link] : others;
  };

  const togglePressed = (role: string): void => {
    const next = new Set(pressed);
    if (next.has(role)) next.delete(role);
    else next.add(role);
    setPressed(next);
  };

  const sortBy = (next: SortKey): void => {
    setSort(sort.key === next && sort.direction === 'asc' ? { key: next, direction: 'desc' } : { key: next, direction: 'asc' });
  };

  const columns: { key: SortKey; label: string; hint?: string }[] = [
    { key: 'file', label: t('objects.col.file') },
    { key: 'name', label: t('objects.col.name') },
    { key: 'role', label: t('objects.col.role') },
    { key: 'key', label: t('objects.col.key') },
    { key: 'group', label: t('objects.col.group') },
    { key: 'material', label: t('objects.col.material') },
    { key: 'texture', label: t('objects.col.texture') },
    { key: 'faces', label: t('objects.col.faces'), hint: t('objects.col.facesHint') },
  ];
  const flagsHeader = t('objects.col.flags');
  const detailRow = firstName === null ? undefined : rows.find((row) => row.name === firstName);

  return (
    <div class="objects" data-testid="objects" data-wagon={wagon?.id ?? ''} data-count={rows.length}>
      <div class="objects-bar">
        <label class="objects-field">
          <span>{t('objects.wagon')}</span>
          <select
            data-testid="objects-wagon"
            value={wagon?.id ?? ''}
            onChange={(event) => {
              const id = event.currentTarget.value;
              setChosen(id === '' ? null : id);
              const entry = stock.find((candidate) => candidate.id === id);
              if (entry?.model != null) selection.value = [{ kind: 'file', file: entry.model }];
            }}
          >
            {wagon === undefined && <option value="">{t('objects.wagon.none')}</option>}
            {stock.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.id}
              </option>
            ))}
          </select>
        </label>
        <label class="objects-field objects-search">
          <span>{t('objects.search')}</span>
          <input
            type="search"
            data-testid="objects-search"
            value={text}
            placeholder={t('objects.search.hint')}
            spellcheck={false}
            onInput={(event) => setText(event.currentTarget.value)}
          />
        </label>
        {built !== null && (
          <div class="objects-legend" role="group" aria-label={t('objects.legend')} data-testid="objects-legend">
            {present.map((role) => (
              <button
                key={role}
                type="button"
                class="objects-chip"
                data-role={role}
                aria-pressed={pressed.has(role)}
                onClick={() => togglePressed(role)}
              >
                <RoleMark role={role} /> <span class="objects-count">{counts.get(role)}</span>
              </button>
            ))}
            <button type="button" class="objects-chip" data-role="lit" aria-pressed={lit} title={t('objects.legend.litHint')} onClick={() => setLit(!lit)}>
              {t('objects.legend.lit')} <span class="objects-count">{rows.filter((row) => row.lit).length}</span>
            </button>
            {(pressed.size > 0 || lit) && (
              <button
                type="button"
                class="objects-chip"
                onClick={() => {
                  setPressed(new Set());
                  setLit(false);
                }}
              >
                {t('objects.legend.all')}
              </button>
            )}
          </div>
        )}
        {built !== null && (
          <p class="objects-summary" role="status" data-testid="objects-summary">
            {t('objects.summary', { shown: shown.length, total: rows.length })}
          </p>
        )}
      </div>

      {wagon === undefined && <p class="objects-hint">{stock.length === 0 ? t('objects.noWagons') : t('objects.pickWagon')}</p>}
      {wagon !== undefined && built === null && failure === null && <p class="objects-hint" role="status">{t('objects.loading')}</p>}
      {failure !== null && (
        <p class="objects-hint" role="status" data-testid="objects-failure">
          {failureText(failure)}
        </p>
      )}

      {built !== null && (
        <>
          <div class="objects-body">
            <div class="objects-scroll" ref={tableRef}>
              {rows.length === 0 ? (
                <p class="objects-hint">{t('objects.empty')}</p>
              ) : (
                <table class="objects-table" aria-label={t('objects.table')} data-testid="objects-table">
                  <thead>
                    <tr>
                      {columns.map((column) => (
                        <th
                          key={column.key}
                          scope="col"
                          title={column.hint}
                          aria-sort={sort.key === column.key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                        >
                          <button type="button" class="objects-sort" data-sort={column.key} aria-label={t('objects.sortBy', { column: column.label })} onClick={() => sortBy(column.key)}>
                            {column.label}
                            {sort.key === column.key && <span aria-hidden="true">{sort.direction === 'asc' ? ' ▲' : ' ▼'}</span>}
                          </button>
                        </th>
                      ))}
                      <th scope="col">{flagsHeader}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drawn.map((row) => (
                      <tr key={row.name} data-object={row.name} data-role={row.role} class={chosenSet.has(row.name) ? 'is-selected' : undefined} aria-current={chosenSet.has(row.name) ? 'true' : undefined}>
                        <td class="objects-num">{row.index + 1}</td>
                        <td class="objects-name">
                          <button
                            type="button"
                            class="objects-pick"
                            onClick={(event) => pick(row, event.shiftKey || event.ctrlKey || event.metaKey)}
                          >
                            {row.name}
                          </button>
                        </td>
                        <td>
                          <RoleMark role={row.role} />
                        </td>
                        <td class="objects-mono">{row.key ?? ''}</td>
                        <td class="objects-mono">
                          {row.controlGroup !== null && <span>{t('objects.group.cg', { group: row.controlGroup })}</span>}
                          {row.controlGroup !== null && row.lightGroup !== null && ' '}
                          {row.lightGroup !== null && <span>{t('objects.group.lcg', { group: row.lightGroup })}</span>}
                        </td>
                        <td class="objects-mono">{row.materials.join(', ')}</td>
                        <td>{row.textured === null ? t('objects.texture.unknown') : row.textured ? t('objects.texture.yes') : t('objects.texture.no')}</td>
                        <td class="objects-num">{row.faces}</td>
                        <td class="objects-mono">{row.flags.join(' ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {drawn.length < shown.length && (
                <p class="objects-hint">
                  {t('objects.more', { shown: drawn.length, hidden: shown.length - drawn.length })}{' '}
                  <button type="button" class="toggle-button" onClick={() => setAll(true)}>
                    {t('objects.more.all')}
                  </button>
                </p>
              )}
            </div>
            <aside class="objects-detail" aria-label={t('objects.detail')}>
              <h3 class="objects-subhead">{t('objects.detail')}</h3>
              <Detail name={firstName} row={detailRow} skip={built.skip} extra={Math.max(0, names.length - 1)} />
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

export { groupOf, SORT_KEYS };
