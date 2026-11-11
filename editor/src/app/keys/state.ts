import { signal } from '@preact/signals';

/** True while the Keys window is open (./KeysDialog.tsx); `?` and the top bar's button set it. */
export const keysDialogOpen = signal(false);
