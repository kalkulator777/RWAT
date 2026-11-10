import { useState } from 'preact/hooks';
import { t } from '../../i18n';
import { run } from '../session';
import { pack, selection } from '../store';
import { Modal } from './Modal';
import { renamedFile, renameTypeCommand, type RenameRefusal } from './rename';

function RenameDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const [value, setValue] = useState(id);
  const [errors, setErrors] = useState<RenameRefusal[]>([]);
  const [busy, setBusy] = useState(false);
  const rename = async (): Promise<void> => {
    const open = pack.value;
    if (open === null) return;
    const result = renameTypeCommand(open, id, value);
    if ('errors' in result) return setErrors(result.errors);
    setBusy(true);
    const done = await run(result.command);
    setBusy(false);
    if (!done) return;
    selection.value = [{ kind: 'file', file: renamedFile(open, value.trim()) }];
    onClose();
  };
  return (
    <Modal title={t('save.rename.title', { id })} testId="rename-dialog" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void rename();
        }}
      >
        <div class="dialog-field">
          <label class="dialog-label" for="rename-id">
            {t('save.rename.id')}
          </label>
          <input
            id="rename-id"
            type="text"
            class="dialog-input mono"
            value={value}
            spellcheck={false}
            autoComplete="off"
            aria-describedby="rename-id-hint"
            onInput={(event) => setValue(event.currentTarget.value)}
          />
          <span class="dialog-hint" id="rename-id-hint">
            {t('save.rename.hint')}
          </span>
        </div>
        {errors.length > 0 && (
          <ul class="dialog-errors" role="alert" data-testid="rename-errors">
            {errors.map((error, i) => (
              <li key={i}>{t(error.key, error.params)}</li>
            ))}
          </ul>
        )}
        <div class="dialog-buttons">
          <button type="button" onClick={onClose}>
            {t('save.rename.cancel')}
          </button>
          <button type="submit" class="button-primary" data-testid="rename-submit" disabled={busy}>
            {t('save.rename.submit')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * "Rename…" of a wagon (its type or its model is shown in the inspector): a dialog for the
 * new id; the rename is one command of the journal (./rename.ts).
 */
export function RenameTypeButton({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const readOnly = pack.value?.readOnly ?? true;
  return (
    <>
      <button type="button" class="inspector-rename" data-testid="rename-wagon" disabled={readOnly} onClick={() => setOpen(true)}>
        {t('save.rename.button')}
      </button>
      {open && <RenameDialog id={id} onClose={() => setOpen(false)} />}
    </>
  );
}
