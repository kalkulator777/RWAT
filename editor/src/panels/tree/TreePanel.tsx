import { pack, problems, revision, selection } from '../../app/store';
import type { Problem } from '../../core/contracts';
import { classify, MCMETA } from '../../core/pack';
import { t } from '../../i18n';

/** Findings per file: [errors, warnings], from the links of the findings. */
function countByFile(list: readonly Problem[]): Map<string, [number, number]> {
  const counts = new Map<string, [number, number]>();
  for (const problem of list) {
    const files = new Set(problem.at.flatMap((link) => ('file' in link ? [link.file] : [])));
    for (const file of files) {
      const entry = counts.get(file) ?? [0, 0];
      if (problem.severity === 'error') entry[0]++;
      else if (problem.severity === 'warning') entry[1]++;
      counts.set(file, entry);
    }
  }
  return counts;
}

function FileButton(props: { file: string; label?: string; counts: Map<string, [number, number]> }) {
  const { file, counts } = props;
  const chosen = selection.value.some((link) => link.kind === 'file' && link.file === file);
  const [errors, warnings] = counts.get(file) ?? [0, 0];
  return (
    <button
      type="button"
      class="tree-file"
      data-file={file}
      aria-current={chosen ? 'true' : undefined}
      title={file}
      onClick={() => {
        selection.value = [{ kind: 'file', file }];
      }}
    >
      <span class="tree-name">{props.label ?? file}</span>
      {errors > 0 && <span class="badge badge-error" aria-label={t('tree.errors', { count: errors })}>{errors}</span>}
      {warnings > 0 && <span class="badge badge-warning" aria-label={t('tree.warnings', { count: warnings })}>{warnings}</span>}
    </button>
  );
}

/**
 * The pack tree (editor.md §6.1): `pack.mcmeta`, wagons as pairs of a type and a model
 * by id (a missing half is said), rail styles, lang files and the rest of the files,
 * each with the number of its findings. Clicking a file selects it.
 */
export function TreePanel() {
  void revision.value;
  const open = pack.value;
  if (open === null) return <p class="slot-empty">{t('shell.empty.tree')}</p>;
  const counts = countByFile(problems.value);
  const stock = open.stock();
  const styles = open.railStyles();
  const langs = open.declarations().filter((declaration) => declaration.kind === 'lang');
  const others = open.paths().filter((path) => path !== MCMETA && classify(path) === null);
  return (
    <nav class="tree" aria-label={t('tree.label')} data-testid="tree">
      <section>
        <h3 class="tree-heading">{t('tree.pack')}</h3>
        {open.has(MCMETA) && <FileButton file={MCMETA} counts={counts} />}
      </section>
      <section data-section="wagons">
        <h3 class="tree-heading">{t('tree.wagons', { count: stock.length })}</h3>
        <ul class="tree-list">
          {stock.map((entry) => (
            <li key={entry.id} data-stock={entry.id}>
              <span class="tree-id">{entry.id}</span>
              <div class="tree-pair">
                {entry.type !== null ? <FileButton file={entry.type} label={t('tree.type')} counts={counts} /> : <span class="tree-missing">{t('tree.noType')}</span>}
                {entry.model !== null ? <FileButton file={entry.model} label={t('tree.model')} counts={counts} /> : <span class="tree-missing">{t('tree.noModel')}</span>}
              </div>
            </li>
          ))}
        </ul>
      </section>
      {styles.length > 0 && (
        <section data-section="rails">
          <h3 class="tree-heading">{t('tree.rails', { count: styles.length })}</h3>
          <ul class="tree-list">
            {styles.map((style) => (
              <li key={style.id}>
                <FileButton file={style.file} label={style.id} counts={counts} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {langs.length > 0 && (
        <section data-section="names">
          <h3 class="tree-heading">{t('tree.names', { count: langs.length })}</h3>
          <ul class="tree-list">
            {langs.map((lang) => (
              <li key={lang.path}>
                <FileButton file={lang.path} counts={counts} />
              </li>
            ))}
          </ul>
        </section>
      )}
      <section data-section="assets">
        <h3 class="tree-heading">{t('tree.assets', { count: others.length })}</h3>
        <ul class="tree-list">
          {others.map((path) => (
            <li key={path}>
              <FileButton file={path} counts={counts} />
            </li>
          ))}
        </ul>
      </section>
    </nav>
  );
}
