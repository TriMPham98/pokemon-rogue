export interface CardSpec {
  title: string;
  body?: string;
  tag?: string;
  tagColor?: string;
  icon?: string; // image URL
  ghost?: boolean;
  locked?: boolean;
  onClick: () => void;
}

export interface HudState {
  round: number;
  remaining: number;
  balls: number;
  hp: number;
  maxHp: number;
  hold: boolean;
  muted: boolean;
  dash: number; // 0..1, 1 = ready
  focus?: string;
}

export interface PartyEntry {
  name: string;
  icon: string;
  level: number;
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
}

export interface Arrow {
  x: number;
  y: number;
  angle: number;
  kind: 'wild' | 'weak' | 'alpha' | 'shiny';
}

const $ = (id: string) => document.getElementById(id)!;
const setText = (el: HTMLElement, text: string) => void (el.textContent !== text && (el.textContent = text));
const setHtml = (el: HTMLElement & { _html?: string }, html: string) => void (el._html !== html && (el.innerHTML = el._html = html));

export class UI {
  private cards: { el: HTMLElement; key: '' | 'empty' | 'filled' }[] = [];
  private arrows: HTMLElement[] = [];
  private hintTimer = 0;

  constructor() {
    $('ui').innerHTML = `
      <div class="hud">
        <div class="pill" id="hud-round"></div>
        <div class="pill" id="hud-left"></div>
        <div class="pill" id="hud-balls"></div>
        <div class="pill trainer-hp">Trainer <div class="bar"><div id="hud-hp"></div></div><span id="hud-hp-text"></span></div>
        <div class="pill" id="hud-mode"></div>
        <div class="pill dash" id="hud-dash"><span>Dash</span><div class="bar"><div id="hud-dash-bar"></div></div></div>
        <div class="pill focus" id="hud-focus"></div>
      </div>
      <div class="party" id="party"></div>
      <div class="hint" id="hint"></div>
      <div class="help" id="help"></div>
      <div class="arrows" id="arrows"></div>
      <div class="floaters" id="floaters"></div>
      <div class="toasts" id="toasts"></div>
      <div class="banner" id="banner"></div>
      <div class="hurt" id="hurt"></div>
      <div class="modal hidden" id="modal"></div>`;
  }

  setHud(s: HudState) {
    $('hud-round').textContent = `Round ${s.round}`;
    $('hud-left').textContent = `Wild left: ${s.remaining}`;
    $('hud-balls').innerHTML = `<span class="ball-icon"></span> × ${s.balls}`;
    const pct = (s.hp / s.maxHp) * 100;
    const hp = $('hud-hp');
    hp.style.width = `${pct}%`;
    hp.style.background = pct > 50 ? '#4cd964' : pct > 25 ? '#ffcc00' : '#ff3b30';
    $('hud-hp-text').textContent = `${Math.ceil(s.hp)}/${s.maxHp}`;
    const mode = $('hud-mode');
    mode.textContent = s.hold ? 'Holding fire' : 'Attacking';
    mode.className = `pill ${s.hold ? 'hold' : 'attack'}`;
    const dash = $('hud-dash-bar');
    dash.style.width = `${s.dash * 100}%`;
    dash.style.background = s.dash >= 1 ? '#5ac8fa' : '#55607a';
    const focus = $('hud-focus');
    focus.style.display = s.focus ? 'flex' : 'none';
    if (s.focus) focus.textContent = `◎ Focus: ${s.focus}`;
    $('help').textContent = `WASD move · Shift dash · Click throw · Right-click focus · F hold fire · Esc pause · M ${s.muted ? 'unmute' : 'mute'}`;
  }

  /**
   * Party cards are patched in place: rebuilding them with innerHTML every tick made each
   * <img> re-decode its data-URL icon, so sprites blinked out for a frame mid-fight.
   */
  setParty(list: PartyEntry[]) {
    const box = $('party');
    while (this.cards.length < 6) {
      const el = document.createElement('div');
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
          <div class="mon-icon-wrap"><img class="mon-icon" alt="" /><span class="badges"></span></div>
          <div class="mon-info">
            <div class="mon-head"><b></b><span class="lv"></span></div>
            <div class="bar"><div class="hp-fill"></div></div>
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
      const pct = Math.max(0, (p.hp / p.maxHp) * 100);
      const fill = q('.hp-fill');
      fill.style.width = `${pct}%`;
      fill.style.background = pct > 50 ? '#4cd964' : pct > 25 ? '#ffcc00' : '#ff3b30';
      q('.dot').style.background = p.color;
      setText(q('.move'), p.fainted ? 'Fainted' : p.move);
      setText(q('.hp-text'), `${Math.ceil(p.hp)}/${p.maxHp}`);
      q('.xp > div').style.width = `${p.xpFrac * 100}%`;
      const cls = ['mon-card', p.fainted && 'fainted', p.hurt && 'hurt', p.evolving && 'evolving'].filter(Boolean).join(' ');
      if (card.el.className !== cls) card.el.className = cls;
    });
  }

  showModal(title: string, subtitle: string, cards: CardSpec[]) {
    const modal = $('modal');
    modal.innerHTML = `<div class="panel"><h1>${title}</h1><p>${subtitle}</p><div class="choices"></div></div>`;
    const choices = modal.querySelector('.choices')!;
    for (const c of cards) {
      const btn = document.createElement('button');
      btn.className = `choice ${c.ghost ? 'ghost' : ''} ${c.locked ? 'locked' : ''}`;
      btn.innerHTML = `
        ${c.icon ? `<img class="icon" src="${c.icon}" alt="" />` : ''}
        <div class="title">${c.title}</div>
        ${c.tag ? `<div class="tag" style="background:${c.tagColor ?? '#666'}">${c.tag}</div>` : ''}
        ${c.body ? `<div class="body">${c.body}</div>` : ''}`;
      // Ignore clicks for a moment so a mid-combat throw click can't pick an option by accident.
      btn.disabled = true;
      if (!c.locked) setTimeout(() => (btn.disabled = false), 450);
      btn.addEventListener('click', c.onClick);
      choices.appendChild(btn);
    }
    modal.classList.remove('hidden');
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

  hurt() {
    const el = $('hurt');
    el.classList.remove('show');
    void el.offsetWidth;
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
