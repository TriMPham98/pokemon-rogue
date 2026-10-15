import { SPECIES, SPECIES_BY_ID, STONE_NAME } from './data';
import { BALLS } from './battle';
import { ROUNDS_PER_AREA } from './biomes';
import { icon, url } from './assets';
import type { Game } from './game';

const STORE = 'pr-debug';
const XP_MULS = [1, 2, 5, 10, 50];
const SPEEDS = [0.25, 0.5, 1, 2, 4];

/**
 * Testing panel: a dropdown in the top-right corner (toggle with ` ) for levelling, evolving, adding Pokémon,
 * skipping rounds and flipping cheats. Mounted in dev builds, or in any build with ?debug in the URL.
 */
export function mountDebug(game: Game) {
  const c = game.cheats;
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) ?? '{}');
    Object.assign(c, saved.cheats);
  } catch {}
  let open = false;
  try {
    open = JSON.parse(localStorage.getItem(STORE) ?? '{}').open === true;
  } catch {}
  const persist = () => {
    try {
      localStorage.setItem(STORE, JSON.stringify({ cheats: c, open }));
    } catch {}
  };

  const species = [...SPECIES].sort((a, b) => a.dex - b.dex);
  const root = document.createElement('div');
  root.className = 'dbg';
  root.innerHTML = `
    <button class="dbg-toggle" data-a="toggle">Debug <span class="caret">▾</span> <kbd>\`</kbd></button>
    <div class="dbg-body">
      <div class="dbg-info" id="dbg-info"></div>
      <h4>Party</h4>
      <div id="dbg-party"></div>
      <div class="dbg-row">
        <button data-a="heal">Heal all</button>
        <button data-a="charge">Charge specials</button>
        <button data-a="evonow" title="Play queued evolutions now instead of at round end">Evolve queued</button>
      </div>
      <div class="dbg-row">
        <select id="dbg-sp">${species.map((s) => `<option value="${s.id}">#${String(s.dex).padStart(3, '0')} ${s.name}</option>`).join('')}</select>
        <span>Lv</span><input id="dbg-lv" type="number" min="1" max="100" value="20" />
        <label title="Shiny"><input id="dbg-shiny" type="checkbox" />✦</label>
      </div>
      <div class="dbg-row">
        <button data-a="add">Add to party</button>
        <button data-a="spawn-sp">Spawn as wild</button>
      </div>
      <h4>Run</h4>
      <div class="dbg-row">
        <span>Round</span><input id="dbg-round" type="number" min="1" value="1" />
        <button data-a="jump">Jump</button>
        <button data-a="next">Next round</button>
        <button data-a="area">Next area</button>
      </div>
      <div class="dbg-row">
        <button data-a="clear" title="KO every wild Pokémon (with XP) and end the round">Clear round</button>
        <button data-a="spawn">Spawn wild</button>
        <button data-a="leader">Spawn leader</button>
        <button data-a="shiny">Spawn shiny</button>
      </div>
      <div class="dbg-row">
        <button data-a="balls">+10 balls</button>
        <button data-a="ball" id="dbg-ball"></button>
      </div>
      <h4>Cheats</h4>
      <div class="dbg-row">
        <label><input type="checkbox" data-c="god" />God mode</label>
        <label><input type="checkbox" data-c="oneShot" />One-hit KO</label>
        <label><input type="checkbox" data-c="sureCatch" />100% catch</label>
      </div>
      <div class="dbg-row">
        <span>XP</span><select data-n="xpMul">${XP_MULS.map((m) => `<option value="${m}">×${m}</option>`).join('')}</select>
        <span>Speed</span><select data-n="speed">${SPEEDS.map((m) => `<option value="${m}">×${m}</option>`).join('')}</select>
      </div>
    </div>`;
  document.getElementById('ui')!.appendChild(root);
  document.body.classList.add('has-dbg');

  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const setOpen = (v: boolean) => {
    open = v;
    root.classList.toggle('open', open);
    persist();
    if (open) refresh(true);
  };

  for (const el of root.querySelectorAll<HTMLInputElement>('[data-c]')) {
    const k = el.dataset.c as 'god' | 'oneShot' | 'sureCatch';
    el.checked = c[k];
    el.addEventListener('change', () => ((c[k] = el.checked), persist()));
  }
  for (const el of root.querySelectorAll<HTMLSelectElement>('[data-n]')) {
    const k = el.dataset.n as 'xpMul' | 'speed';
    el.value = String(c[k]);
    el.addEventListener('change', () => ((c[k] = Number(el.value)), persist()));
  }

  const picked = () => SPECIES_BY_ID[$<HTMLSelectElement>('dbg-sp').value];
  const num = (id: string) => Number($<HTMLInputElement>(id).value) || 1;

  root.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
    if (!btn) return;
    const p = btn.dataset.i !== undefined ? game.party[Number(btn.dataset.i)] : undefined;
    const round = game.dbgInfo.round;
    switch (btn.dataset.a) {
      case 'toggle': return setOpen(!open);
      case 'lv': if (p) game.dbgSetLevel(p, p.level + Number(btn.dataset.d)); break;
      case 'evo': if (p) game.dbgEvolve(p, SPECIES_BY_ID[btn.dataset.to!]); break;
      case 'release': if (p) game.dbgRelease(p); break;
      case 'heal': game.dbgHeal(); break;
      case 'charge': game.dbgCharge(); break;
      case 'evonow': void game.dbgPlayEvolutions(); break;
      case 'add': game.dbgAddMon(picked(), num('dbg-lv'), $<HTMLInputElement>('dbg-shiny').checked); break;
      case 'spawn-sp': game.dbgSpawn({ sp: picked(), shiny: $<HTMLInputElement>('dbg-shiny').checked }); break;
      case 'jump': game.dbgJump(num('dbg-round')); break;
      case 'next': game.dbgJump(round + 1); break;
      case 'area': game.dbgJump(Math.floor((round - 1) / ROUNDS_PER_AREA + 1) * ROUNDS_PER_AREA + 1); break;
      case 'clear': game.dbgClearRound(); break;
      case 'spawn': game.dbgSpawn({}); break;
      case 'leader': game.dbgSpawn({ leader: true }); break;
      case 'shiny': game.dbgSpawn({ shiny: true }); break;
      case 'balls': game.dbgBalls(10); break;
      case 'ball': game.dbgCycleBall(); break;
    }
    refresh(true);
  });
  // Don't let clicks on the panel fall through to the game (throwing balls, unlocking the title screen).
  root.addEventListener('pointerdown', (e) => e.stopPropagation());
  window.addEventListener('keydown', (e) => {
    if (e.key !== '`' || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    e.preventDefault();
    setOpen(!open);
  });

  // Party rows are rebuilt only when something they show changes, so buttons don't vanish under the cursor.
  let sig = '';
  function refresh(force = false) {
    if (!open) return;
    const info = game.dbgInfo;
    const infoText = `${info.state} · ${info.biome} · round ${info.round} · ${info.wilds} wild on field`;
    const infoEl = $('dbg-info');
    if (infoEl.textContent !== infoText) infoEl.textContent = infoText;
    $('dbg-ball').textContent = `Ball: ${BALLS[info.ball].name}`;
    const roundEl = $<HTMLInputElement>('dbg-round');
    if (document.activeElement !== roundEl && force) roundEl.value = String(info.round + 1);
    const next = game.party.map((p) => `${p.sp.id}:${p.level}:${p.shiny}:${p.fainted}`).join('|');
    if (next === sig && !force) return;
    sig = next;
    $('dbg-party').innerHTML = game.party
      .map((p, i) => {
        const evos = (p.sp.evos ?? [])
          .map((e) => {
            const to = SPECIES_BY_ID[e.to];
            const how = e.stone ? STONE_NAME[e.stone] : e.level !== undefined ? `Lv${e.level}` : 'trade';
            return `<button data-a="evo" data-i="${i}" data-to="${to.id}" title="${how}">→ ${to.name}</button>`;
          })
          .join('');
        const lv = (d: number, label: string) => `<button data-a="lv" data-i="${i}" data-d="${d}">${label}</button>`;
        return `<div class="dbg-mon${p.fainted ? ' fainted' : ''}">
          <img src="${icon(url.front(p.sp.dex, p.shiny))}" alt="" />
          <b>${p.shiny ? '✦' : ''}${p.sp.name}</b><span class="lvl">Lv${p.level}</span>
          <div class="dbg-row">${lv(-1, '−1')}${lv(1, '+1')}${lv(5, '+5')}${lv(10, '+10')}${lv(100, 'Max')}${evos}
            <button class="danger" data-a="release" data-i="${i}" title="Release">✕</button></div>
        </div>`;
      })
      .join('') || '<div class="dbg-empty">Pick a starter first.</div>';
  }
  setInterval(refresh, 300);
  setOpen(open);
}
