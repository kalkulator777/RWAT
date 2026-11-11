import { useState } from 'preact/hooks';
import { useRoving } from '../../app/keys/roving';
import { findings, pack, revision, selection } from '../../app/store';
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

/** A node of the tree as it is drawn: a branch with its items, a file, or the word for a half a wagon lacks. */
type TreeNode =
  | { kind: 'branch'; key: string; label: string; children: TreeNode[]; section?: string; stock?: string; heading: boolean }
  | { kind: 'file'; key: string; file: string; label: string }
  | { kind: 'missing'; key: string; label: string };

/** The tree of the open pack (editor.md §6.1): the pack file, the wagons as a type and a model each, rail styles, lang files, the rest. */
function treeOf(open: NonNullable<typeof pack.value>): TreeNode[] {
  const stock = open.stock();
  const styles = open.railStyles();
  const langs = open.declarations().filter((declaration) => declaration.kind === 'lang');
  const others = open.paths().filter((path) => path !== MCMETA && classify(path) === null);
  const file = (path: string, label?: string): TreeNode => ({ kind: 'file', key: `file:${path}`, file: path, label: label ?? path });
  const nodes: TreeNode[] = [
    { kind: 'branch', key: 'pack', label: t('tree.pack'), heading: true, section: 'pack', children: open.has(MCMETA) ? [file(MCMETA)] : [] },
    {
      kind: 'branch',
      key: 'wagons',
      label: t('tree.wagons', { count: stock.length }),
      heading: true,
      section: 'wagons',
      children: stock.map(
        (entry): TreeNode => ({
          kind: 'branch',
          key: `wagon:${entry.id}`,
          label: entry.id,
          heading: false,
          stock: entry.id,
          children: [
            entry.type !== null ? file(entry.type, t('tree.type')) : { kind: 'missing', key: `missing:${entry.id}:type`, label: t('tree.noType') },
            entry.model !== null ? file(entry.model, t('tree.model')) : { kind: 'missing', key: `missing:${entry.id}:model`, label: t('tree.noModel') },
          ],
        }),
      ),
    },
  ];
  if (styles.length > 0) nodes.push({ kind: 'branch', key: 'rails', label: t('tree.rails', { count: styles.length }), heading: true, section: 'rails', children: styles.map((style) => file(style.file, style.id)) });
  if (langs.length > 0) nodes.push({ kind: 'branch', key: 'names', label: t('tree.names', { count: langs.length }), heading: true, section: 'names', children: langs.map((lang) => file(lang.path)) });
  nodes.push({ kind: 'branch', key: 'assets', label: t('tree.assets', { count: others.length }), heading: true, section: 'assets', children: others.map((path) => file(path)) });
  return nodes;
}

/** The keys of the nodes that show, in the order shown: a closed branch hides what is in it. */
function visibleKeys(nodes: readonly TreeNode[], closed: ReadonlySet<string>): string[] {
  return nodes.flatMap((node) => (node.kind === 'branch' && !closed.has(node.key) ? [node.key, ...visibleKeys(node.children, closed)] : [node.key]));
}

interface RowProps {
  node: TreeNode;
  level: number;
  closed: ReadonlySet<string>;
  toggle: (key: string) => void;
  counts: Map<string, [number, number]>;
  roving: ReturnType<typeof useRoving>;
}

function Badges({ file, counts }: { file: string; counts: Map<string, [number, number]> }) {
  const [errors, warnings] = counts.get(file) ?? [0, 0];
  return (
    <>
      {errors > 0 && (
        <span class="badge badge-error" role="img" aria-label={t('tree.errors', { count: errors })}>
          {errors}
        </span>
      )}
      {warnings > 0 && (
        <span class="badge badge-warning" role="img" aria-label={t('tree.warnings', { count: warnings })}>
          {warnings}
        </span>
      )}
    </>
  );
}

function Row({ node, level, closed, toggle, counts, roving }: RowProps) {
  const item = roving.props(node.key);
  if (node.kind === 'missing') {
    return (
      <li role="none">
        <div role="treeitem" class="tree-missing" aria-level={level} {...item}>
          {node.label}
        </div>
      </li>
    );
  }
  if (node.kind === 'file') {
    const chosen = selection.value.some((link) => (link.kind === 'file' || link.kind === 'field') && link.file === node.file);
    return (
      <li role="none">
        <div
          role="treeitem"
          class="tree-file"
          aria-level={level}
          aria-selected={chosen}
          data-file={node.file}
          title={node.file}
          {...item}
          onClick={() => {
            selection.value = [{ kind: 'file', file: node.file }];
          }}
        >
          <span class="tree-name">{node.label}</span>
          <Badges file={node.file} counts={counts} />
        </div>
      </li>
    );
  }
  const open = !closed.has(node.key);
  const groupId = `tree-group-${node.key}`;
  return (
    <li role="none" data-section={node.section} data-stock={node.stock}>
      <div
        role="treeitem"
        class={node.heading ? 'tree-branch tree-heading' : 'tree-branch tree-id'}
        aria-level={level}
        aria-expanded={open}
        aria-owns={open && node.children.length > 0 ? groupId : undefined}
        {...item}
        onClick={() => toggle(node.key)}
      >
        {node.label}
      </div>
      {open && node.children.length > 0 && (
        <ul role="group" id={groupId} class={node.heading ? 'tree-list' : 'tree-list tree-pair'}>
          {node.children.map((child) => (
            <Row key={child.key} node={child} level={level + 1} closed={closed} toggle={toggle} counts={counts} roving={roving} />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * The pack tree (editor.md §6.1, §6.3): `pack.mcmeta`, wagons as pairs of a type and a model
 * by id (a missing half is said), rail styles, lang files and the rest of the files, each
 * with the number of its findings. An ARIA tree with one stop of the Tab key: the arrows
 * move between its items, Right and Left open and close a branch, Enter and Space choose
 * (app/keys). Clicking a file selects it, and the inspector shows its form.
 */
export function TreePanel() {
  void revision.value;
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const open = pack.value;
  const nodes = open === null ? [] : treeOf(open);
  const chosen = selection.value.find((link) => link.kind === 'file' || link.kind === 'field');
  const roving = useRoving(visibleKeys(nodes, closed), chosen === undefined ? null : `file:${chosen.file}`);
  if (open === null) return <p class="slot-empty">{t('shell.empty.tree')}</p>;
  const counts = countByFile(findings.value);
  const toggle = (key: string): void => {
    const next = new Set(closed);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setClosed(next);
  };
  return (
    <div class="tree" data-testid="tree">
      <ul role="tree" class="tree-root" aria-label={t('tree.label')} data-roving="tree">
        {nodes.map((node) => (
          <Row key={node.key} node={node} level={1} closed={closed} toggle={toggle} counts={counts} roving={roving} />
        ))}
      </ul>
    </div>
  );
}
