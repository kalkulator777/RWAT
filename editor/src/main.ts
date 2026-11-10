import './app/styles.css';
import { start } from './app/start';

const root = document.getElementById('app');
if (!root) throw new Error('index.html has no #app element');
start(root);

// The browser tests reach the Python bridge (e2e/pyodide/); a user's page loads none of it.
if ((globalThis as { __RWAT_E2E__?: unknown }).__RWAT_E2E__ === true) void import('./ir/bridge').then((bridge) => bridge.exposeForTests());
