import { signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { openSource, run } from '../../app/session';
import { dirtyCount, pack, schema, selection } from '../../app/store';
import { MCMETA, railPath, typePath } from '../../core/pack';
import { t } from '../../i18n';
import { NAME_LANGS } from '../names/model';
import { addFilesCommand, addRailCommand, addWagonCommand, checkNewPack, modelFolder, newPackSource, railFolder, packNamespaces, type NewPackInput, type PickedFile, type WizardError } from './model';

/** The namespace the last new pack was made with: the wagon dialog offers it while the pack has no files under it yet. */
const lastNamespace = signal('');

/** A modal dialog (the browser's own `<dialog>`: focus stays inside, Escape closes it). */
function Dialog(props: { title: string; testId: string; onClose: () => void; onSubmit: () => void; submit: string; busy?: boolean; children: ComponentChildren }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog !== null && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
  }, []);
  const titleId = `${props.testId}-title`;
  return (
    <dialog
      ref={ref}
      class="dialog"
      aria-labelledby={titleId}
      data-testid={props.testId}
      onCancel={(event) => {
        event.preventDefault();
        props.onClose();
      }}
    >
      <form
        class="dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          props.onSubmit();
        }}
      >
        <h2 id={titleId} class="dialog-title">
          {props.title}
        </h2>
        {props.children}
        <div class="dialog-buttons">
          <button type="button" onClick={props.onClose}>
            {t('newpack.cancel')}
          </button>
          <button type="submit" class="button-primary" disabled={props.busy === true}>
            {props.submit}
          </button>
        </div>
      </form>
    </dialog>
  );
}

function Errors({ list }: { list: readonly WizardError[] }) {
  if (list.length === 0) return null;
  return (
    <ul class="dialog-errors" role="alert">
      {list.map((error, i) => (
        <li key={i}>{t(error.key, error.params)}</li>
      ))}
    </ul>
  );
}

/** One labelled box of a dialog; its hint is its description, not part of its name. */
function Input(props: { label: string; value: string; onInput: (value: string) => void; hint?: string; name: string; list?: string; mono?: boolean }) {
  const id = `newpack-${props.name}`;
  return (
    <div class="dialog-field">
      <label class="dialog-label" for={id}>
        {props.label}
      </label>
      <input
        id={id}
        type="text"
        name={props.name}
        class={props.mono === true ? 'dialog-input mono' : 'dialog-input'}
        value={props.value}
        list={props.list}
        spellcheck={false}
        autoComplete="off"
        aria-describedby={props.hint === undefined ? undefined : `${id}-hint`}
        onInput={(event) => props.onInput(event.currentTarget.value)}
      />
      {props.hint !== undefined && (
        <span class="dialog-hint" id={`${id}-hint`}>
          {props.hint}
        </span>
      )}
    </div>
  );
}

const LICENSES = ['CC0-1.0', 'CC-BY-4.0', 'CC-BY-SA-4.0', 'CC-BY-NC-4.0', 'MIT'];

function NewPackDialog({ onClose }: { onClose: () => void }) {
  const [input, setInput] = useState<NewPackInput>({ name: '', namespace: '', title: '', version: '1.0.0', authors: '', license: '', description: '' });
  const [errors, setErrors] = useState<WizardError[]>([]);
  const [busy, setBusy] = useState(false);
  const field = (key: keyof NewPackInput) => (value: string) => setInput({ ...input, [key]: value });
  const loaded = schema.value;
  const create = async (): Promise<void> => {
    if (loaded === null) return setErrors([{ key: 'newpack.error.schema' }]);
    const found = checkNewPack(input, loaded);
    setErrors(found);
    if (found.length > 0) return;
    setBusy(true);
    const opened = await openSource(newPackSource(input));
    setBusy(false);
    if (!opened) return;
    lastNamespace.value = input.namespace.trim();
    selection.value = [{ kind: 'file', file: MCMETA }];
    onClose();
  };
  return (
    <Dialog title={t('newpack.pack.title')} testId="new-pack-dialog" onClose={onClose} onSubmit={() => void create()} submit={t('newpack.pack.create')} busy={busy}>
      <Input name="name" label={t('newpack.pack.name')} hint={t('newpack.pack.nameHint')} value={input.name} onInput={field('name')} />
      <Input name="namespace" label={t('newpack.pack.namespace')} hint={t('newpack.pack.namespaceHint')} value={input.namespace} onInput={field('namespace')} mono />
      <fieldset class="dialog-group">
        <legend>{t('newpack.pack.rwat')}</legend>
        <Input name="title" label={t('newpack.pack.titleField')} hint={t('newpack.pack.titleHint')} value={input.title} onInput={field('title')} />
        <Input name="version" label={t('newpack.pack.version')} value={input.version} onInput={field('version')} />
        <Input name="authors" label={t('newpack.pack.authors')} hint={t('newpack.pack.authorsHint')} value={input.authors} onInput={field('authors')} />
        <Input name="license" label={t('newpack.pack.license')} hint={t('newpack.pack.licenseHint')} value={input.license} onInput={field('license')} list="newpack-licenses" />
        <datalist id="newpack-licenses">
          {LICENSES.map((license) => (
            <option key={license} value={license} />
          ))}
        </datalist>
        <Input name="description" label={t('newpack.pack.description')} value={input.description} onInput={field('description')} />
      </fieldset>
      {pack.value !== null && dirtyCount.value > 0 && <p class="dialog-warning">{t('newpack.pack.unsaved', { count: dirtyCount.value })}</p>}
      {loaded === null && <p class="dialog-hint">{t('newpack.error.schema')}</p>}
      <Errors list={errors} />
    </Dialog>
  );
}

async function readPicked(files: readonly File[]): Promise<PickedFile[]> {
  return Promise.all(files.map(async (file) => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })));
}

function AddWagonDialog({ onClose }: { onClose: () => void }) {
  const open = pack.value;
  const namespaces = open === null ? [] : packNamespaces(open);
  const [namespace, setNamespace] = useState(namespaces[0] ?? lastNamespace.value);
  const [id, setId] = useState('');
  const [folder, setFolder] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [numbers, setNumbers] = useState({ length: '', massT: '', bogieFront: '', bogieRear: '' });
  const [names, setNames] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<WizardError[]>([]);
  const [busy, setBusy] = useState(false);
  const loaded = schema.value;
  const number = (key: keyof typeof numbers) => (value: string) => setNumbers({ ...numbers, [key]: value });
  const add = async (): Promise<void> => {
    if (open === null) return;
    if (loaded === null) return setErrors([{ key: 'newpack.error.schema' }]);
    setBusy(true);
    const result = addWagonCommand(open, { namespace, id, folder, files: await readPicked(files), ...numbers, names }, loaded);
    if ('errors' in result) {
      setBusy(false);
      return setErrors(result.errors);
    }
    const done = await run(result.command);
    setBusy(false);
    if (!done) return;
    selection.value = [{ kind: 'file', file: typePath(`${namespace.trim()}:${id.trim()}`) }];
    onClose();
  };
  return (
    <Dialog title={t('newpack.wagon.title')} testId="add-wagon-dialog" onClose={onClose} onSubmit={() => void add()} submit={t('newpack.wagon.add')} busy={busy}>
      <Input name="namespace" label={t('newpack.pack.namespace')} value={namespace} onInput={setNamespace} list="newpack-namespaces" mono />
      <datalist id="newpack-namespaces">
        {namespaces.map((ns) => (
          <option key={ns} value={ns} />
        ))}
      </datalist>
      <Input name="id" label={t('newpack.wagon.id')} hint={t('newpack.wagon.idHint')} value={id} onInput={setId} mono />
      <Input name="folder" label={t('newpack.wagon.folder')} hint={t('newpack.wagon.folderHint', { folder: modelFolder({ folder: '', id: id || '<id>' }) })} value={folder} onInput={setFolder} mono />
      <FilesInput label={t('newpack.wagon.files')} hint={t('newpack.wagon.filesHint')} accept=".obj,.mtl,.png,.anim,.ogg" onPick={setFiles} />
      <fieldset class="dialog-group">
        <legend>{t('newpack.wagon.required')}</legend>
        <Input name="length" label={t('newpack.wagon.length')} value={numbers.length} onInput={number('length')} mono />
        <Input name="mass_t" label={t('newpack.wagon.mass')} value={numbers.massT} onInput={number('massT')} mono />
        <Input name="bogie_front" label={t('newpack.wagon.bogieFront')} value={numbers.bogieFront} onInput={number('bogieFront')} mono />
        <Input name="bogie_rear" label={t('newpack.wagon.bogieRear')} value={numbers.bogieRear} onInput={number('bogieRear')} mono />
      </fieldset>
      <fieldset class="dialog-group">
        <legend>{t('newpack.wagon.names')}</legend>
        {NAME_LANGS.map((code) => (
          <Input key={code} name={`name_${code}`} label={code} value={names[code] ?? ''} onInput={(value) => setNames({ ...names, [code]: value })} />
        ))}
      </fieldset>
      <Errors list={errors} />
    </Dialog>
  );
}

/** A file input that takes several files; `accept` narrows the browser's picker. */
function FilesInput(props: { label: string; hint: string; accept?: string; onPick: (files: File[]) => void }) {
  return (
    <div class="dialog-field">
      <label class="dialog-label" for="newpack-files">
        {props.label}
      </label>
      <input
        id="newpack-files"
        type="file"
        name="files"
        class="dialog-input"
        accept={props.accept}
        multiple
        aria-describedby="newpack-files-hint"
        onChange={(event) => props.onPick([...(event.currentTarget.files ?? [])])}
      />
      <span class="dialog-hint" id="newpack-files-hint">
        {props.hint}
      </span>
    </div>
  );
}

function AddRailDialog({ onClose }: { onClose: () => void }) {
  const open = pack.value;
  const namespaces = open === null ? [] : packNamespaces(open);
  const [namespace, setNamespace] = useState(namespaces[0] ?? lastNamespace.value);
  const [id, setId] = useState('');
  const [folder, setFolder] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [tileLength, setTileLength] = useState('');
  const [names, setNames] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<WizardError[]>([]);
  const [busy, setBusy] = useState(false);
  const loaded = schema.value;
  const add = async (): Promise<void> => {
    if (open === null) return;
    if (loaded === null) return setErrors([{ key: 'newpack.error.schema' }]);
    setBusy(true);
    const result = addRailCommand(open, { namespace, id, folder, files: await readPicked(files), tileLength, names }, loaded);
    if ('errors' in result) {
      setBusy(false);
      return setErrors(result.errors);
    }
    const done = await run(result.command);
    setBusy(false);
    if (!done) return;
    selection.value = [{ kind: 'file', file: railPath(`${namespace.trim()}:${id.trim()}`) }];
    onClose();
  };
  return (
    <Dialog title={t('newpack.rail.title')} testId="add-rail-dialog" onClose={onClose} onSubmit={() => void add()} submit={t('newpack.rail.add')} busy={busy}>
      <Input name="namespace" label={t('newpack.pack.namespace')} value={namespace} onInput={setNamespace} list="newpack-namespaces" mono />
      <datalist id="newpack-namespaces">
        {namespaces.map((ns) => (
          <option key={ns} value={ns} />
        ))}
      </datalist>
      <Input name="id" label={t('newpack.rail.id')} hint={t('newpack.rail.idHint')} value={id} onInput={setId} mono />
      <Input name="folder" label={t('newpack.rail.folder')} hint={t('newpack.wagon.folderHint', { folder: railFolder({ folder: '', id: id || '<id>' }) })} value={folder} onInput={setFolder} mono />
      <FilesInput label={t('newpack.rail.files')} hint={t('newpack.rail.filesHint')} accept=".obj,.mtl,.png" onPick={setFiles} />
      <Input name="tile_length" label={t('newpack.rail.tileLength')} hint={t('newpack.rail.tileLengthHint')} value={tileLength} onInput={setTileLength} mono />
      <fieldset class="dialog-group">
        <legend>{t('newpack.wagon.names')}</legend>
        {NAME_LANGS.map((code) => (
          <Input key={code} name={`name_${code}`} label={code} value={names[code] ?? ''} onInput={(value) => setNames({ ...names, [code]: value })} />
        ))}
      </fieldset>
      <Errors list={errors} />
    </Dialog>
  );
}

function AddFilesDialog({ onClose }: { onClose: () => void }) {
  const open = pack.value;
  const namespaces = open === null ? [] : packNamespaces(open);
  const namespace = namespaces[0] ?? lastNamespace.value;
  const [folder, setFolder] = useState(namespace === '' ? '' : `assets/${namespace}/`);
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<WizardError[]>([]);
  const [busy, setBusy] = useState(false);
  const add = async (): Promise<void> => {
    if (open === null) return;
    setBusy(true);
    const result = addFilesCommand(open, { folder, files: await readPicked(files) });
    if ('errors' in result) {
      setBusy(false);
      return setErrors(result.errors);
    }
    const done = await run(result.command);
    setBusy(false);
    if (done) onClose();
  };
  return (
    <Dialog title={t('newpack.files.title')} testId="add-files-dialog" onClose={onClose} onSubmit={() => void add()} submit={t('newpack.files.add')} busy={busy}>
      <Input name="folder" label={t('newpack.files.folder')} hint={t('newpack.files.folderHint')} value={folder} onInput={setFolder} mono />
      <FilesInput label={t('newpack.files.files')} hint={t('newpack.files.filesHint')} onPick={setFiles} />
      <Errors list={errors} />
    </Dialog>
  );
}

/**
 * "New pack", "Add wagon", "Add rail style" and "Add files" in the top bar (editor.md
 * §2.1, steps 1–2): a dialog each. A new pack replaces the open one (unsaved changes are
 * warned about); a wagon, a rail style and files are added to the open pack as one
 * command each, so undo takes it back.
 */
export function NewPackPanel() {
  const [dialog, setDialog] = useState<'pack' | 'wagon' | 'rail' | 'files' | null>(null);
  const open = pack.value;
  const closed = open === null || open.readOnly;
  return (
    <div class="file-actions">
      <button type="button" data-testid="new-pack" onClick={() => setDialog('pack')}>
        {t('newpack.newPack')}
      </button>
      <button type="button" data-testid="add-wagon" disabled={closed} onClick={() => setDialog('wagon')}>
        {t('newpack.addWagon')}
      </button>
      <button type="button" data-testid="add-rail" disabled={closed} onClick={() => setDialog('rail')}>
        {t('newpack.addRail')}
      </button>
      <button type="button" data-testid="add-files" disabled={closed} onClick={() => setDialog('files')}>
        {t('newpack.addFiles')}
      </button>
      {dialog === 'pack' && <NewPackDialog onClose={() => setDialog(null)} />}
      {dialog === 'wagon' && <AddWagonDialog onClose={() => setDialog(null)} />}
      {dialog === 'rail' && <AddRailDialog onClose={() => setDialog(null)} />}
      {dialog === 'files' && <AddFilesDialog onClose={() => setDialog(null)} />}
    </div>
  );
}
