import { h } from 'preact';
import { definePanel } from '../../app/registry';
import { toolHost } from '../../tools';
import { ToolSwitcher } from '../../tools/ToolBar';
import { ViewPanel } from '../../view3d/ViewPanel';

/** The 3D view in the centre of the screen (editor.md §6.1), the markup tools' switch in its bar; the modules are view3d/ and tools/. */
export default definePanel({ id: 'view', slot: 'view', order: 10, title: 'view3d.title', component: () => h(ViewPanel, { tools: h(ToolSwitcher, { host: toolHost }) }) });
