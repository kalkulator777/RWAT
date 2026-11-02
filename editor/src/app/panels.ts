import { collectPanels, type PanelModule } from './registry';

/** Every panel of the editor: the folders src/panels/<name>/ with an index.ts or index.tsx (see ./registry.ts). */
export const panels = collectPanels(import.meta.glob<PanelModule>('../panels/*/index.{ts,tsx}', { eager: true }));
