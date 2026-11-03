import { definePanel } from '../../app/registry';
import { ViewPanel } from '../../view3d/ViewPanel';

/** The 3D view in the centre of the screen (editor.md §6.1); the module is view3d/. */
export default definePanel({ id: 'view', slot: 'view', order: 10, title: 'view3d.title', component: ViewPanel });
