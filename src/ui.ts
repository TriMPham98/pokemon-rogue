import { audio } from './audio';

export interface StatBar {
  label: string;
  value: number;
}

export interface CardSpec {
  title: string;
  body?: string;
  tag?: string;
  tagColor?: string;
  types?: TypeChip[]; // one pill per type, shown in place of `tag`
  move?: TypeChip; // outlined pill after the type pills
  icon?: string; // image URL
  ghost?: boolean;
  stats?: StatBar[]; // base-stat bars (starter picker)
  onClick: () => void;
}

export interface HudState {
  area: string;
  round: number;
  remaining: number;
  total: number; // wild Pokémon this round, for the progress bar
  balls: number;
  ballName: string;
  ballIcon: string;
  hold: boolean;
  muted: boolean;
  dash: number; // 0..1, 1 = ready
  focus?: string;
}

/** The title screen: the trainer flanked by Pokémon, plus meta-progress from earlier runs. */
export interface HeroSpec {
  trainer: string; // overworld sheet URL; its first frame (facing down) is shown
  frames: number;
  lineup: string[]; // animated sprite URLs, left to right; the trainer stands in the middle
  stats: { label: string; value: string }[];
}

export interface TypeChip {
  label: string;
  color: string;
}

export interface PartyEntry {
  name: string;
  icon: string;
  level: number;
  types: TypeChip[];
  move: string;
  color: string;
  hp: number;
  maxHp: number;
  xpFrac: number;
  fainted: boolean;
  hurt: boolean;
  evolving: boolean;
  evoLevel?: number;
  evoStones: string[];
  shiny: boolean;
  status?: TypeChip;
  active: boolean; // the one out of its ball
}

/** The wild Pokémon under the cursor: who it is, how hurt, and the odds of catching it right now. */
export interface TargetInfo {
  x: number;
  y: number;
  name: string;
  level: number;
  types: TypeChip[];
  hpFrac: number;
  status?: TypeChip;
  catchPct: number;
  leader: boolean;
  shiny: boolean;
  /** Best type matchup among your party's moves against it: 'good' if someone hits it super effectively. */
  matchup?: 'good' | 'bad';
}

export interface Arrow {
  x: number;
  y: number;
  angle: number;
  kind: 'wild' | 'weak' | 'leader' | 'shiny';
}

const $ = (id: string) => document.getElementById(id)!;
const setText = (el: HTMLElement, text: string) => void (el.textContent !== text && (el.textContent = text));
const setHtml = (el: HTMLElement & { _html?: string }, html: string) => void (el._html !== html && (el.innerHTML = el._html = html));
const hpColor = (pct: number) => (pct > 50 ? 'var(--hp-good)' : pct > 25 ? 'var(--hp-mid)' : 'var(--hp-low)');
const chip = (c: TypeChip, cls = 'type') => `<span class="${cls}" style="background:${c.color}">${c.label}</span>`;

export class UI {
  private cards: { el: HTMLElement; key: '' | 'empty' | 'filled' }[] = [];
  private arrows: HTMLElement[] = [];
  private hintTimer = 0;
  /** Clicking a party card (switches to that Pokémon). */
  onPartyClick: (i: number) => void = () => {};

  constructor() {
    $('ui').innerHTML = `
      <div class="hud">
        <div class="panel-glass run-panel">
          <div class="status-head"><span class="area" id="hud-area"></span><span class="round" id="hud-round"></span></div>
          <div class="progress"><div id="hud-progress"></div></div>
          <div class="status-sub" id="hud-left"></div>
        </div>
        <div class="chips">
          <div class="chip" id="hud-balls"><img id="hud-ball-icon" alt="" /><b id="hud-ball-count"></b><span id="hud-ball-name"></span></div>
          <div class="chip mode" id="hud-mode"><span class="on-attack">⚔ Attacking</span><span class="on-hold">✋ Holding fire</span></div>
          <div class="chip dash" id="hud-dash"><span>Dash</span><div class="bar"><div id="hud-dash-bar"></div></div></div>
          <div class="chip focus" id="hud-focus"></div>
        </div>
      </div>
      <div class="target" id="target"></div>
      <div class="party" id="party"></div>
      <div class="hint" id="hint"></div>
      <div class="help" id="help"></div>
      <div class="arrows" id="arrows"></div>
      <div class="floaters" id="floaters"></div>
      <div class="toasts" id="toasts"></div>
      <div class="banner" id="banner"></div>
      <div class="modal hidden" id="modal"></div>
      <div class="hero hidden" id="hero"></div>`;
  }

  setHud(s: HudState) {
    setText($('hud-area'), s.area);
    setText($('hud-round'), `Round ${s.round}`);
    $('hud-progress').style.width = `${s.total ? (1 - s.remaining / s.total) * 100 : 0}%`;
    setText($('hud-left'), s.remaining ? `${s.remaining} wild Pokémon left` : 'Area clear');
    const ball = $('hud-ball-icon') as HTMLImageElement;
    if (ball.getAttribute('src') !== s.ballIcon) ball.src = s.ballIcon;
    setText($('hud-ball-count'), `×${s.balls}`);
    setText($('hud-ball-name'), s.ballName);
    $('hud-balls').classList.toggle('empty', s.balls === 0);
    const mode = $('hud-mode');
    const modeCls = `chip mode ${s.hold ? 'hold' : 'attack'}`;
    if (mode.className !== modeCls) mode.className = modeCls;
    const dash = $('hud-dash-bar');
    dash.style.width = `${s.dash * 100}%`;
    dash.style.background = s.dash >= 1 ? 'var(--accent)' : '#55607a';
    const focus = $('hud-focus');
    focus.style.display = s.focus ? 'flex' : 'none';
    if (s.focus) setText(focus, `◎ Focus: ${s.focus}`);
    setHtml(
      $('help'),
      ['WASD move', '1-6 switch', 'Shift dash', 'Click throw', 'Right-click hold/attack', 'E focus', 'Esc pause', `M ${s.muted ? 'unmute' : 'mute'}`]
        .map((t) => {
          const [k, ...rest] = t.split(' ');
          return `<span><kbd>${k}</kbd>${rest.join(' ')}</span>`;
        })
        .join(''),
    );
  }

  setTarget(t: TargetInfo | null) {
    const el = $('target');
    if (!t) return void (el.style.display = 'none');
    el.style.display = 'block';
    el.style.transform = `translate(${Math.round(t.x)}px, ${Math.round(t.y)}px) translate(-50%, -100%)`;
    const pct = Math.max(0, t.hpFrac * 100);
    setHtml(
      el,
      `<div class="t-head">${t.leader ? '<span class="leader">★</span>' : ''}${t.shiny ? '<span class="shiny">✦</span>' : ''}<b>${t.name}</b><span class="lv">Lv${t.level}</span></div>
       <div class="t-types">${t.types.map((c) => chip(c)).join('')}${t.status ? chip(t.status, 'status') : ''}</div>
       <div class="bar"><div style="width:${pct}%;background:${hpColor(pct)}"></div></div>
       <div class="t-foot"><span class="catch ${t.catchPct >= 50 ? 'good' : t.catchPct >= 20 ? 'ok' : ''}">◓ ${t.catchPct}% catch</span>${
         t.matchup === 'good' ? '<span class="se">Super effective</span>' : t.matchup === 'bad' ? '<span class="nve">Resists your team</span>' : ''
       }</div>`,
    );
  }

  /**
   * Party cards are patched in place: rebuilding them with innerHTML every tick made each
   * <img> re-decode its data-URL icon, so sprites blinked out for a frame mid-fight.
   */
  setParty(list: PartyEntry[]) {
    const box = $('party');
    while (this.cards.length < 6) {
      const el = document.createElement('div');
      const i = this.cards.length;
      el.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.onPartyClick(i);
      });
      box.appendChild(el);
      this.cards.push({ el, key: '' });
    }
    this.cards.forEach((card, i) => {
      const p = list[i];
      if (!p) {
        if (card.key !== 'empty') (card.key = 'empty'), (card.el.className = 'mon-card empty'), (card.el.innerHTML = '');
        return;
      }
      if (card.key === 'empty' || card.key === '') {
        card.el.innerHTML = `
          <span class="slot"></span>
          <div class="mon-icon-wrap"><img class="mon-icon" alt="" /><span class="badges"></span></div>
          <div class="mon-info">
            <div class="mon-head"><b></b><span class="lv"></span></div>
            <div class="mon-types"></div>
            <div class="bar hp"><div class="hp-fill"></div></div>
            <div class="mon-foot"><span><span class="dot"></span><span class="move"></span></span><span class="hp-text"></span></div>
            <div class="xp"><div></div></div>
          </div>`;
        card.key = 'filled';
      }
      const q = (sel: string) => card.el.querySelector<HTMLElement>(sel)!;
      const img = q('.mon-icon') as HTMLImageElement;
      if (img.getAttribute('src') !== p.icon) img.src = p.icon;
      setHtml(
        q('.badges'),
        (p.evoLevel ? `<span class="evo-lv" title="Evolves at Lv${p.evoLevel}">${p.evoLevel}</span>` : '') +
          (p.evoStones.length ? `<span class="evo-stones" title="Evolves with a stone">${p.evoStones.map((s) => `<img src="${s}" alt="" />`).join('')}</span>` : ''),
      );
      setHtml(q('.mon-head b'), `${p.shiny ? '<span class="shiny">✦</span>' : ''}${p.name}`);
      setText(q('.lv'), `Lv${p.level}`);
      setText(q('.slot'), p.active ? '▶' : String(i + 1));
      setHtml(q('.mon-types'), p.types.map((c) => chip(c)).join('') + (p.status && !p.fainted ? chip(p.status, 'status') : ''));
      const pct = Math.max(0, (p.hp / p.maxHp) * 100);
      const fill = q('.hp-fill');
      fill.style.width = `${pct}%`;
      fill.style.background = hpColor(pct);
      q('.dot').style.background = p.color;
      setText(q('.move'), p.fainted ? 'Fainted' : p.move);
      setText(q('.hp-text'), `${Math.ceil(p.hp)}/${p.maxHp}`);
      q('.xp > div').style.width = `${p.xpFrac * 100}%`;
      const cls = ['mon-card', p.active && 'active', p.fainted && 'fainted', p.hurt && 'hurt', p.evolving && 'evolving'].filter(Boolean).join(' ');
      if (card.el.className !== cls) card.el.className = cls;
    });
  }

  /** `extra` is raw HTML placed between the subtitle and the choices (e.g. the party summary on pause). */
  showModal(title: string, subtitle: string, cards: CardSpec[], extra = '') {
    const modal = $('modal');
    modal.innerHTML = `<div class="panel"><h1>${title}</h1><p>${subtitle}</p>${extra}<div class="choices"></div></div>`;
    const choices = modal.querySelector('.choices')!;
    for (const c of cards) {
      const btn = document.createElement('button');
      btn.className = `choice ${c.ghost ? 'ghost' : ''}`;
      btn.innerHTML = `
        ${c.icon ? `<img class="icon" src="${c.icon}" alt="" />` : ''}
        <div class="title">${c.title}</div>
        ${c.tag ? `<div class="tag" style="background:${c.tagColor ?? '#666'}">${c.tag}</div>` : ''}
        ${c.types ? `<div class="tags">${c.types.map((t) => `<span class="tag" style="background:${t.color}">${t.label}</span>`).join('')}${c.move ? `<span class="tag move" style="border-color:${c.move.color}">${c.move.label}</span>` : ''}</div>` : ''}
        ${c.body ? `<div class="body">${c.body}</div>` : ''}
        ${c.stats ? `<div class="stats">${c.stats.map((s) => statRow(s.label, s.value)).join('')}</div>` : ''}`;
      // Ignore clicks for a moment so a mid-combat throw click can't pick an option by accident.
      btn.disabled = true;
      setTimeout(() => (btn.disabled = false), 450);
      btn.addEventListener('click', () => {
        audio.ui();
        c.onClick();
      });
      choices.appendChild(btn);
    }
    modal.classList.remove('hidden');
  }

  showHero(h: HeroSpec, onStart: () => void) {
    const el = $('hero');
    const mon = (src: string, i: number) => `<img class="hero-mon" style="--i:${i}" src="${src}" alt="" />`;
    const half = Math.ceil(h.lineup.length / 2);
    el.innerHTML = `
      <div class="hero-inner">
        <div class="hero-kicker">A Kanto roguelike</div>
        <h1 class="hero-logo">Pokémon<span>Rogue</span></h1>
        <div class="hero-stage">
          ${h.lineup.slice(0, half).map(mon).join('')}
          <div class="hero-trainer" style="background-image:url(${h.trainer});background-size:${h.frames * 100}% 100%"></div>
          ${h.lineup.slice(half).map((s, i) => mon(s, i + half)).join('')}
        </div>
        <p class="hero-tag">Survive endless waves of wild Pokémon. Weaken them, catch them, and build a team of six.</p>
        <button class="hero-start">Start</button>
        <div class="hero-press">or press <kbd>Enter</kbd></div>
        ${h.stats.length ? `<div class="hero-stats">${h.stats.map((s) => `<div><b>${s.value}</b><span>${s.label}</span></div>`).join('')}</div>` : ''}
      </div>`;
    el.querySelector('.hero-start')!.addEventListener('click', onStart);
    el.classList.remove('hidden');
    $('ui').classList.add('on-title');
  }

  hideHero() {
    $('hero').classList.add('hidden');
    $('ui').classList.remove('on-title');
  }

  hideModal() {
    $('modal').classList.add('hidden');
  }

  toast(msg: string, kind: 'info' | 'good' | 'bad' | 'warn' = 'info') {
    const box = $('toasts');
    while (box.children.length >= 3) box.firstElementChild!.remove();
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => el.remove(), 2800);
  }

  /** Contextual tutorial line above the party panel. */
  hint(text: string) {
    const el = $('hint');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => el.classList.remove('show'), 6000);
  }

  banner(title: string, sub: string) {
    const el = $('banner');
    el.innerHTML = `<h2>${title}</h2><p>${sub}</p>`;
    el.classList.remove('show');
    void el.offsetWidth; // restart animation
    el.classList.add('show');
  }

  floater(text: string, color: string, big: boolean) {
    const el = document.createElement('div');
    el.className = `floater ${big ? 'big' : ''}`;
    el.textContent = text;
    el.style.color = color;
    $('floaters').appendChild(el);
    return el;
  }

  /** Edge-of-screen pointers toward off-screen wild Pokémon. */
  setArrows(list: Arrow[]) {
    const box = $('arrows');
    while (this.arrows.length < list.length) {
      const el = document.createElement('div');
      el.className = 'arrow';
      box.appendChild(el);
      this.arrows.push(el);
    }
    this.arrows.forEach((el, i) => {
      const a = list[i];
      el.style.display = a ? 'block' : 'none';
      if (!a) return;
      el.className = `arrow ${a.kind}`;
      el.style.transform = `translate(${a.x}px, ${a.y}px) translate(-50%, -50%) rotate(${a.angle}rad)`;
    });
  }
}

/** One labelled stat bar; `max` fills it (150 for base stats: only a handful of Kanto stats go past it). */
export function statRow(label: string, value: number, max = 150) {
  const pct = Math.min(100, (value / max) * 100);
  const hue = Math.round(Math.min(1, (value / max) * 1.15) * 130); // red → green
  return `<div class="stat"><span>${label}</span><div class="sbar"><div style="width:${pct}%;background:hsl(${hue} 70% 52%)"></div></div><b>${value}</b></div>`;
}
