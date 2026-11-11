import { lang, t } from '../../i18n';
import { Modal } from '../save/Modal';
import { KEY_SCOPES } from './actions';
import { detectPlatform } from './chords';
import { keyReference } from './reference';
import { keysDialogOpen } from './state';
import './keys.css';

/**
 * The Keys window (docs/proposals/editor.md §6.3): every shortcut of the key map
 * (./actions.ts) under the scope where it works, in the interface language, with the keys of
 * the user's platform. A modal dialog like the others (./modal.ts): the focus stays in it,
 * Escape closes it, the focus goes back to where it was.
 */
export function KeysDialog() {
  const platform = detectPlatform();
  const rows = keyReference();
  const current = lang.value;
  return (
    <Modal
      title={t('keys.title')}
      testId="keys-dialog"
      wide
      onClose={() => {
        keysDialogOpen.value = false;
      }}
    >
      <p class="dialog-hint">{t(`keys.intro.${platform}`)}</p>
      <p class="dialog-hint">{t('keys.intro.typing')}</p>
      {KEY_SCOPES.map((scope) => (
        <section key={scope} class="keys-scope" data-scope={scope} aria-labelledby={`keys-scope-${scope}`}>
          <h3 id={`keys-scope-${scope}`} class="keys-heading">
            {t(`keys.scope.${scope}`)}
          </h3>
          <p class="dialog-hint">{t(`keys.scope.${scope}.hint`)}</p>
          <table class="keys-table">
            <thead>
              <tr>
                <th scope="col">{t('keys.col.action')}</th>
                <th scope="col">{t('keys.col.keys')}</th>
              </tr>
            </thead>
            <tbody>
              {rows
                .filter((row) => row.scope === scope)
                .map((row) => (
                  <tr key={row.id} data-action={row.id}>
                    <th scope="row" class="keys-title">
                      {row.title[current]}
                      {row.widget !== undefined && <span class="keys-itself"> ({t('keys.itself')})</span>}
                    </th>
                    <td class="keys-keys">
                      {row.keys[platform].map((chord) => (
                        <kbd key={chord}>{chord}</kbd>
                      ))}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      ))}
      <div class="dialog-buttons">
        <button
          type="button"
          class="button-primary"
          data-testid="keys-close"
          onClick={() => {
            keysDialogOpen.value = false;
          }}
        >
          {t('keys.close')}
        </button>
      </div>
    </Modal>
  );
}
