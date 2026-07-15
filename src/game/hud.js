// DOM-driven HUD: symmetric angled HP bars meeting at the round score, cyan
// stamina bars, thin guard slivers, glowing ult pills, popup texts, round
// intro cards, KO banner, letterbox bars and hit-flash vignette.

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.el = {
      root: $('hud'),
      hp1: $('hp-p1'), hp2: $('hp-p2'),
      hpFill1: $('hp-p1-fill'), hpFill2: $('hp-p2-fill'),
      hpGhost1: $('hp-p1-ghost'), hpGhost2: $('hp-p2-ghost'),
      st1: $('st-p1-fill'), st2: $('st-p2-fill'),
      gd1: $('gd-p1-fill'), gd2: $('gd-p2-fill'),
      ult1: $('ult-p1'), ult2: $('ult-p2'),
      ultFill1: $('ult-p1-fill'), ultFill2: $('ult-p2-fill'),
      score: $('score'),
      name1: $('name-p1'), name2: $('name-p2'),
      popupSide: $('popup-side'),
      popupCenter: $('popup-center'),
      roundCard: $('round-card'),
      roundTitle: $('round-title'), roundSub: $('round-sub'),
      flash: $('flash'), vignette: $('vignette'),
      tint: $('cine-tint'), speedlines: $('speedlines'),
      lbTop: $('letterbox-top'), lbBottom: $('letterbox-bottom'),
      fps: $('fps-debug'),
      touch: $('touch-controls'),
      title: $('title-screen'),
      victory: $('victory-screen'),
      victoryText: $('victory-text'),
      victorySub: $('victory-sub'),
    };
    this._ghostTimers = [0, 0];
    this._hpShown = [100, 100];
  }

  setNames(a, b) { this.el.name1.textContent = a; this.el.name2.textContent = b; }

  bars(p1, p2, rdt) {
    this._bar(0, p1, this.el.hpFill1, this.el.hpGhost1, this.el.st1, this.el.gd1, this.el.ultFill1, this.el.ult1, rdt);
    this._bar(1, p2, this.el.hpFill2, this.el.hpGhost2, this.el.st2, this.el.gd2, this.el.ultFill2, this.el.ult2, rdt);
  }

  _bar(i, f, hp, ghost, st, gd, ultFill, ultPill, rdt) {
    const hpFrac = Math.max(0, f.hp) / 100;
    hp.style.transform = `scaleX(${hpFrac})`;
    // white "damage ghost" bar that lags behind
    const shown = this._hpShown[i];
    const next = shown > hpFrac ? Math.max(hpFrac, shown - rdt * 0.35) : hpFrac;
    this._hpShown[i] = next;
    ghost.style.transform = `scaleX(${next})`;
    st.style.transform = `scaleX(${Math.max(0, f.stamina) / 100})`;
    gd.style.transform = `scaleX(${Math.max(0, f.guard) / 100})`;
    const u = Math.max(0, f.ult) / 100;
    ultFill.style.transform = `scaleX(${u})`;
    ultPill.classList.toggle('ready', u >= 1);
  }

  score(a, b) { this.el.score.textContent = `${a} – ${b}`; }

  // side popup (COUNTER!, GUARD BREAK!, DODGE)
  popupSide(text, cls = '') {
    const el = this.el.popupSide;
    el.textContent = text;
    el.className = 'popup-side show ' + cls;
    clearTimeout(this._sideT);
    this._sideT = setTimeout(() => el.classList.remove('show'), 900);
  }

  // big center popup (K.O.!)
  popupCenter(text, cls = '', hold = 1400) {
    const el = this.el.popupCenter;
    el.textContent = text;
    el.className = 'popup-center show ' + cls;
    clearTimeout(this._centerT);
    this._centerT = setTimeout(() => el.classList.remove('show'), hold);
  }

  roundCard(title, sub, hold = 1100) {
    const c = this.el.roundCard;
    this.el.roundTitle.textContent = title;
    this.el.roundSub.textContent = sub || '';
    c.classList.add('show');
    clearTimeout(this._roundT);
    this._roundT = setTimeout(() => c.classList.remove('show'), hold);
  }

  hideRoundCard() { this.el.roundCard.classList.remove('show'); }

  flash(opacity = 0.75, ms = 90, color = '#fff') {
    const f = this.el.flash;
    f.style.background = color;
    f.style.transition = 'none';
    f.style.opacity = opacity;
    requestAnimationFrame(() => {
      f.style.transition = `opacity ${ms}ms ease-out`;
      f.style.opacity = 0;
    });
  }

  // accent-colored energy tint pulse (ultimate beats); decays to 0 over ms
  tint(color = '#27e6ff', opacity = 0.5, ms = 260) {
    const el = this.el.tint;
    el.style.setProperty('--tint', color);
    el.style.transition = 'none';
    el.style.opacity = opacity;
    requestAnimationFrame(() => {
      el.style.transition = `opacity ${ms}ms ease-out`;
      el.style.opacity = 0;
    });
  }

  speedLines(on) { this.el.speedlines.classList.toggle('on', on); }

  damageVignette() {
    const v = this.el.vignette;
    v.classList.remove('pulse');
    void v.offsetWidth;
    v.classList.add('pulse');
  }

  letterbox(on) { document.body.classList.toggle('letterbox', on); }

  showTouch(on) { this.el.touch.classList.toggle('hidden', !on); }
  showTitle(on) { this.el.title.classList.toggle('hidden', !on); }
  showHud(on) { this.el.root.classList.toggle('hidden', !on); }

  showVictory(win, score) {
    this.el.victoryText.textContent = win ? 'VICTORY' : 'DEFEAT';
    this.el.victoryText.className = win ? 'win' : 'lose';
    this.el.victorySub.textContent = `final score  ${score}`;
    this.el.victory.classList.remove('hidden');
  }
  hideVictory() { this.el.victory.classList.add('hidden'); }

  fps(text) { this.el.fps.textContent = text; }
  fpsVisible(on) { this.el.fps.classList.toggle('hidden', !on); }
}
