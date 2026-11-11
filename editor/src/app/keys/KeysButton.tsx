import { t } from '../../i18n';
import { announcement } from './announce';
import { KeysDialog } from './KeysDialog';
import { keysDialogOpen } from './state';
import './keys.css';

/** A keyboard, drawn in the text's colour. Decoration: the button carries the name. */
function KeyboardIcon() {
  return (
    <svg class="icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <rect x="1.5" y="3.5" width="13" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4" />
      <path d="M4 6.5h1M7.5 6.5h1M11 6.5h1M4 9.5h1M11 9.5h1M6.5 9.5h3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
    </svg>
  );
}

/** What the keys said without a sound of their own (./announce.ts), for a screen reader. */
function Announcer() {
  return (
    <div class="visually-hidden" role="status" aria-live="polite" aria-atomic="true" data-testid="announcer">
      {announcement.value}
    </div>
  );
}

/**
 * The top bar's Keys button, the window it opens (./KeysDialog.tsx) and the live region the
 * key map speaks through (./announce.ts). The panel of the toolbar slot (src/panels/keys).
 */
export function KeysPanel() {
  return (
    <div class="file-actions">
      <button
        type="button"
        class="icon-button"
        data-testid="keys-button"
        aria-label={t('keys.button')}
        aria-haspopup="dialog"
        title={t('keys.button.hint')}
        onClick={() => {
          keysDialogOpen.value = true;
        }}
      >
        <KeyboardIcon />
      </button>
      {keysDialogOpen.value && <KeysDialog />}
      <Announcer />
    </div>
  );
}
