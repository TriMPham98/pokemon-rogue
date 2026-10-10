import './style.css';
import { Game } from './game';

const game = new Game(document.getElementById('app')!);
// Handy for poking at state from the devtools console.
if (import.meta.env.DEV) Object.assign(window, { game });
