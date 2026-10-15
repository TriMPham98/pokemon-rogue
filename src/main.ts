import './style.css';
import { Game } from './game';
import { audio } from './audio';
import { mountDebug } from './debug';

const game = new Game(document.getElementById('app')!);
// Handy for poking at state from the devtools console.
if (import.meta.env.DEV) Object.assign(window, { game, audio });
// The debug panel (toggle with `): always in dev, and in any build with ?debug in the URL.
if (import.meta.env.DEV || new URLSearchParams(location.search).has('debug')) mountDebug(game);
