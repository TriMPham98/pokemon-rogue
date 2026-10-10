export interface CardSpec {
  title: string;
  body?: string;
  tag?: string;
  tagColor?: string;
  icon?: string;
  ghost?: boolean;
  onClick: () => void;
}

export interface HudState {
  round: number;
  remaining: number;
  balls: number;
  hp: number;
  maxHp: number;
  hold: boolean;
}

export interface PartyEntry {
  name: string;
  level: number;
  type: string;
  color: string;
  hp: number;
  maxHp: number;
  xpFrac: number;
  fainted: boolean;
}

const $ = (id: string) => document.getElementById(id)!;

export class UI {
  private lastParty = '';

  constructor() {
    $('ui').innerHTML = `
      <div class="hud">
        <div class="pill" id="hud-round"></div>
        <div class="pill" id="hud-left"></div>
        <div class="pill" id="hud-balls"></div>
        <div class="pill trainer-hp">Trainer <div class="bar"><div id="hud-hp"></div></div><span id="hud-hp-text"></span></div>
        <div class="pill" id="hud-mode"></div>
      </div>
      <div class="party" id="party"></div>
      <div class="help">WASD move · Click / Space throw Poké Ball · F hold fire / attack</div>
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
    mode.textContent = s.hold ? 'HOLDING FIRE' : 'ATTACKING';
    mode.className = `pill ${s.hold ? 'hold' : 'attack'}`;
  }

  setParty(list: PartyEntry[]) {
    let html = '';
    for (let i = 0; i < 6; i++) {
      const p = list[i];
      if (!p) {
        html += `<div class="mon-card empty">empty</div>`;
        continue;
      }
      const pct = Math.max(0, (p.hp / p.maxHp) * 100);
      const col = pct > 50 ? '#4cd964' : pct > 25 ? '#ffcc00' : '#ff3b30';
      html += `
        <div class="mon-card ${p.fainted ? 'fainted' : ''}">
          <div class="mon-head"><span class="dot" style="background:${p.color}"></span><b>${p.name}</b><span class="lv">Lv${p.level}</span></div>
          <div class="bar"><div style="width:${pct}%;background:${col}"></div></div>
          <div class="mon-foot"><span>${p.fainted ? 'FAINTED' : p.type}</span><span>${Math.ceil(p.hp)}/${p.maxHp}</span></div>
          <div class="xp"><div style="width:${p.xpFrac * 100}%"></div></div>
        </div>`;
    }
    if (html !== this.lastParty) {
      this.lastParty = html;
      $('party').innerHTML = html;
    }
  }

  showModal(title: string, subtitle: string, cards: CardSpec[]) {
    const modal = $('modal');
    modal.innerHTML = `<div class="panel"><h1>${title}</h1><p>${subtitle}</p><div class="choices"></div></div>`;
    const choices = modal.querySelector('.choices')!;
    for (const c of cards) {
      const btn = document.createElement('button');
      btn.className = `choice ${c.ghost ? 'ghost' : ''}`;
      btn.innerHTML = `
        ${c.icon ? `<div class="icon">${c.icon}</div>` : ''}
        <div class="title">${c.title}</div>
        ${c.tag ? `<div class="tag" style="background:${c.tagColor ?? '#666'}">${c.tag}</div>` : ''}
        ${c.body ? `<div class="body">${c.body}</div>` : ''}`;
      // Ignore clicks for a moment so a mid-combat throw click can't pick an option by accident.
      btn.disabled = true;
      setTimeout(() => (btn.disabled = false), 450);
      btn.addEventListener('click', c.onClick);
      choices.appendChild(btn);
    }
    modal.classList.remove('hidden');
  }

  hideModal() {
    $('modal').classList.add('hidden');
  }

  toast(msg: string, kind: 'info' | 'good' | 'bad' | 'warn' = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = msg;
    $('toasts').appendChild(el);
    setTimeout(() => el.remove(), 2800);
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
}
