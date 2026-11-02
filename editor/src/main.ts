import './app/styles.css';
import { start } from './app/start';

const root = document.getElementById('app');
if (!root) throw new Error('index.html has no #app element');
start(root);
