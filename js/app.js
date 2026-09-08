/* Experience — онлайн-версия трансформационной игры. Логика и интерфейс. */
(function () {
  'use strict';
  const D = window.DATA, G = window.GEO;
  const STORAGE_KEY = 'experience.v1';
  const $ = (s, r) => (r || document).querySelector(s);
  const pad2 = n => String(n).padStart(2, '0');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nl2br = s => esc(s).replace(/\n/g, '<br>');
  const shuffle = arr => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const fmtDate = ts => new Date(ts).toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const ASSET = p => (window.ASSETS && window.ASSETS[p]) || p; // в автономной сборке картинки встроены в файл
  const tokenImg = id => ASSET(`assets/tokens/${pad2(id)}.webp`);
  const cardImg = (kind, n) => ASSET(`${D.DECKS[kind].dir}/${pad2(n)}.webp`);
  const DIR_TEXT = { right: 'направо', left: 'налево' };
  const ICONS = {
    eye: '<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/><path d="M12 2v2m0 16v2M4 4l2 2m12 12 2 2M20 4l-2 2M6 18l-2 2"/>',
    book: '<path d="M12 5v16M3 3c4 0 6 0 9 2 3-2 5-2 9-2v16c-4 0-6 0-9 2-3-2-5-2-9-2Z"/>',
    arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    star: '<path d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5Z"/>',
    air: '<path d="M3 8h12c5 0 5-6 1-6M2 12h17c4 0 4 6 0 6M4 16h7c4 0 4 6 0 6"/>',
    water: '<path d="M3 6c4-5 6 5 10 0s6 0 8 0M3 12c4-5 6 5 10 0s6 0 8 0M3 18c4-5 6 5 10 0s6 0 8 0"/>',
    fire: '<path d="M12 2c2 6-5 7-5 12a5 5 0 0 0 10 0c0-3-2-4-1-7 6 5 7 14-4 15C1 21 3 12 7 8c-1 4 1 5 2 5 0-4 4-5 3-11Z"/>',
    earth: '<path d="m12 2 9 5v10l-9 5-9-5V7Z"/><path d="m3 7 9 5 9-5m-9 5v10"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4m-4 4v3"/>'
  };
  const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.star}</svg>`;
  const footer = () => `<footer class="site-footer"><span>EXPERIENCE <i>·</i> Пространство твоих открытий</span><span>${icon('lock')} Твой путь сохраняется в этом браузере</span></footer>`;

  /* ---------------- хранилище ---------------- */
  let store = loadStore();
  function loadStore() {
    try { const s = JSON.parse(localStorage.getItem(STORAGE_KEY)); if (s && Array.isArray(s.games)) return s; } catch (e) { /* пусто */ }
    return { games: [], activeId: null };
  }
  function save() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); } catch (e) { console.warn('save failed', e); } }
  const ui = { view: 'home', selected: null, sheetId: null, flash: null, rules: false, toast: null, confirmDelete: null, textModal: null };
  const activeGame = () => store.games.find(g => g.id === store.activeId) || null;
  const gameById = id => store.games.find(g => g.id === id) || null;

  function newGame() {
    return {
      id: uid(), createdAt: Date.now(), updatedAt: Date.now(),
      phase: 'request', step: 'ask',
      request: { text: '', answers: [], history: [], rethinks: [], negWarn: 0 },
      element: null,
      bag: shuffle(Object.keys(D.TOKENS).map(Number)),
      hand: [], path: [], journal: [],
      decks: {
        obstacle: shuffle(D.range(1, D.DECKS.obstacle.count)),
        resource: shuffle(D.range(1, D.DECKS.resource.count)),
        hint: shuffle(D.range(1, D.DECKS.hint.count)),
        parting: shuffle(D.range(0, D.PARTING.length - 1))
      },
      attempts: 0, drew: false, turn: 0, pending: null, finish: null, notes: ''
    };
  }
  function touch(g) { g.updatedAt = Date.now(); save(); }
  const isNegative = text => D.NEGATION_PATTERNS.some(p => p.test(text));
  const statusText = g => g.phase === 'finished' ? 'Завершена' : g.phase === 'exited' ? 'Прервана (выход)' : g.phase === 'request' ? 'Формулировка запроса' : g.phase === 'entry' ? 'Вход в игру' : 'В пути';

  /* ---------------- механика пути ---------------- */
  const occupied = (g, cellId) => g.path.some(p => p.cell === cellId);
  const isEye = id => G.EYE_CELLS.includes(id);
  const isExit = id => G.EXIT_CELLS.includes(id);
  function rotFor(token, cell, entryEdge, choice) {
    const tok = D.TOKENS[token];
    let stub = tok.stub || 'bottom';
    if (token === 4 && choice === 'left') stub = 'upperRight';
    return G.cells[cell].edges[entryEdge].normal - D.STUB_NORMAL[stub];
  }
  function validExit(g, cell, edge) {
    if (edge == null) return false;
    const nb = G.cells[cell].edges[edge].neighbor;
    if (nb === null) return false;
    return !occupied(g, nb);
  }
  function drawDeck(g, kind) {
    if (!g.decks[kind].length) g.decks[kind] = shuffle(D.range(1, D.DECKS[kind].count));
    return g.decks[kind].shift();
  }
  // Куда ляжет следующая карта и можно ли пойти данной картой
  function nextSlot(g) {
    const last = g.path[g.path.length - 1];
    if (!last) return { ok: false, reason: 'Сначала нужно войти в игру.' };
    if (last.exitEdge == null) return { ok: false, reason: 'Сначала выбери направление пути.' };
    const cell = G.cells[last.cell].edges[last.exitEdge].neighbor;
    if (cell === null || occupied(g, cell)) return { ok: false, reason: 'Путь упёрся в тупик.', dead: true };
    const entryEdge = G.sharedEdge(cell, last.cell);
    return { ok: true, cell, entryEdge, isEye: isEye(cell), isExit: isExit(cell), sides: G.sideEdges(cell, entryEdge) };
  }
  function canPlay(g, token) {
    const slot = nextSlot(g);
    if (!slot.ok) return slot;
    const tok = D.TOKENS[token];
    const res = { ok: true, ...slot, validRight: false, validLeft: false };
    if (slot.isEye || slot.isExit) return res;
    res.validRight = validExit(g, slot.cell, slot.sides.right);
    res.validLeft = validExit(g, slot.cell, slot.sides.left);
    if (tok.exit === 'right' && !res.validRight) return { ok: false, reason: 'Эта карта ведёт направо, а там пути нет.' };
    if (tok.exit === 'left' && !res.validLeft) return { ok: false, reason: 'Эта карта ведёт налево, а там пути нет.' };
    if (tok.exit === 'free' && !res.validRight && !res.validLeft) return { ok: false, reason: 'Из этой клетки дальше пути нет.' };
    return res;
  }
  function playableTokens(g) { return g.hand.filter(t => canPlay(g, t).ok); }

  function placeCard(g, token) {
    const chk = canPlay(g, token);
    if (!chk.ok) { toast(chk.reason); return; }
    const tok = D.TOKENS[token];
    g.hand.splice(g.hand.indexOf(token), 1);
    let exitEdge = null, choice = null;
    if (tok.exit === 'right' || tok.exit === 'left') { exitEdge = chk.sides[tok.exit]; choice = tok.exit; }
    else if (chk.validRight && !chk.validLeft) { exitEdge = chk.sides.right; choice = 'right'; }
    else if (chk.validLeft && !chk.validRight) { exitEdge = chk.sides.left; choice = 'left'; }
    const entry = { token, cell: chk.cell, entryEdge: chk.entryEdge, exitEdge, choice, rot: rotFor(token, chk.cell, chk.entryEdge, choice) };
    g.path.push(entry);
    g.turn++;
    const step = g.journal.filter(j => j.t === 'card').length + 1;
    const rec = { t: 'card', step, token, kind: tok.kind, card: null, note: '', dir: choice, element: tok.element || null, ts: Date.now() };
    if (chk.isEye) {
      g.journal.push(rec, { t: 'arrive', ts: Date.now() });
      g.pending = { type: 'finish' };
    } else if (chk.isExit) {
      g.journal.push(rec);
      g.pending = { type: 'exitChoice', source: 'board' };
    } else {
      if (D.DECKS[tok.kind]) rec.card = drawDeck(g, tok.kind);
      g.journal.push(rec);
      entry.j = g.journal.length - 1;
      if (tok.kind === 'exit') g.pending = { type: 'exitChoice', source: 'card', j: entry.j };
      else g.pending = { type: 'effect', j: entry.j };
    }
    ui.selected = null;
    touch(g);
  }
  function afterEffect(g) {
    const last = g.path[g.path.length - 1];
    if (last.exitEdge == null) g.pending = { type: 'direction' };
    else endTurn(g);
  }
  function endTurn(g) {
    g.pending = null;
    g.drew = false;
    const slot = nextSlot(g);
    if (!slot.ok && slot.dead) stepBack(g);
    touch(g);
  }
  function chooseDirection(g, cellId) {
    const last = g.path[g.path.length - 1];
    const sides = G.sideEdges(last.cell, last.entryEdge);
    let choice = null, edge = null;
    for (const side of ['right', 'left']) {
      const e = sides[side];
      if (e != null && G.cells[last.cell].edges[e].neighbor === cellId && validExit(g, last.cell, e)) { choice = side; edge = e; }
    }
    if (!choice) { toast('Сюда путь не ведёт.'); return; }
    last.exitEdge = edge; last.choice = choice; last.rot = rotFor(last.token, last.cell, last.entryEdge, choice);
    if (last.j != null && g.journal[last.j]) g.journal[last.j].dir = choice;
    endTurn(g);
  }
  function directionCells(g) {
    const last = g.path[g.path.length - 1];
    if (!last || last.exitEdge != null) return [];
    const sides = G.sideEdges(last.cell, last.entryEdge);
    const out = [];
    for (const side of ['right', 'left']) {
      const e = sides[side];
      if (validExit(g, last.cell, e)) out.push({ cell: G.cells[last.cell].edges[e].neighbor, side });
    }
    return out;
  }
  // Есть ли ход из текущего положения: подходящая карта в резерве или возможность взять карту, когда путь впереди открыт
  function wayForwardFrom(g, cell, entryEdge) {
    if (isEye(cell) || isExit(cell)) return true;
    const s = G.sideEdges(cell, entryEdge);
    return validExit(g, cell, s.right) || validExit(g, cell, s.left);
  }
  function hasWayForward(g) {
    const slot = nextSlot(g);
    return slot.ok && wayForwardFrom(g, slot.cell, slot.entryEdge);
  }
  function canProceed(g) {
    const last = g.path[g.path.length - 1];
    if (!last) return false;
    const check = () => playableTokens(g).length > 0 || (g.bag.length > 0 && hasWayForward(g));
    if (last.exitEdge != null) return check();
    const sides = G.sideEdges(last.cell, last.entryEdge);
    for (const d of directionCells(g)) {
      last.exitEdge = sides[d.side];
      const ok = check();
      last.exitEdge = null;
      if (ok) return true;
    }
    return false;
  }
  function stepBack(g) {
    let removed = 0;
    while (g.path.length > 1 && !canProceed(g)) {
      const last = g.path.pop();
      g.bag.push(last.token); removed++;
      const nl = g.path[g.path.length - 1];
      if (D.TOKENS[nl.token].exit === 'free') { nl.exitEdge = null; nl.choice = null; nl.rot = rotFor(nl.token, nl.cell, nl.entryEdge, null); }
    }
    g.bag = shuffle(g.bag);
    g.drew = false;
    g.pending = { type: 'back', removed };
    touch(g);
  }
  function refillBag(g) {
    if (g.path.length <= 3) return 0;
    const keep = new Set([0, g.path.length - 1, g.path.length - 2]);
    const removed = [];
    g.path = g.path.filter((p, i) => keep.has(i) || (removed.push(p.token), false));
    g.bag = shuffle(removed);
    return removed.length;
  }
  function drawCard(g) {
    if (g.drew) { toast('За один ход можно взять только одну новую карту.'); return; }
    if (!g.bag.length) {
      const n = refillBag(g);
      if (n) toast(`Пройденные карты пути вернулись в мешочек: ${n}.`);
    }
    if (!g.bag.length) { toast('В мешочке больше нет карт.'); return; }
    const t = g.bag.shift();
    g.hand.push(t); g.drew = true; ui.flash = t; ui.selected = t;
    touch(g);
  }
  function enterGame(g, token) {
    const el = D.TOKENS[token].element;
    g.element = el;
    const s = G.startCell(el);
    g.path.push({ token, cell: s.cell, entryEdge: s.entryEdge, exitEdge: null, choice: null, rot: rotFor(token, s.cell, s.entryEdge, null) });
    g.phase = 'play'; g.step = null;
    g.journal.push({ t: 'enter', token, element: el, attempts: g.attempts, ts: Date.now() });
    g.pending = { type: 'enterInfo' };
    touch(g);
  }
  function entryDraw(g) {
    if (!g.bag.length) { toast('Мешочек пуст.'); return; }
    const t = g.bag.shift();
    if (D.TOKENS[t].kind === 'element') { enterGame(g, t); return; }
    g.hand.push(t); g.attempts++; ui.flash = t;
    g.pending = { type: 'reserveInfo', token: t };
    touch(g);
  }

  /* ---------------- рендер ---------------- */
  const app = $('#app');
  function render() {
    const g = activeGame();
    const screen = `${ui.view}:${g ? g.id + ':' + g.phase + ':' + g.step : ''}`;
    // Keep unfinished answers when a dialog or toast redraws the same screen.
    const drafts = document.body.dataset.screen === screen
      ? new Map([...app.querySelectorAll('textarea')].map(field => [field.id, field.value])) : new Map();
    let html = '';
    if (ui.view === 'home') html = renderHome();
    else if (ui.view === 'diary') html = renderDiary();
    else if (ui.view === 'sheet') html = renderSheet(gameById(ui.sheetId));
    else if (ui.view === 'game') {
      if (!g) { ui.view = 'home'; html = renderHome(); }
      else if (g.phase === 'request') html = renderRequest(g);
      else if (g.phase === 'finished' || g.phase === 'exited') { ui.view = 'sheet'; ui.sheetId = g.id; html = renderSheet(g); }
      else html = renderGame(g);
    }
    app.innerHTML = html + renderModal(g) + (ui.rules ? renderRules() : '') + (ui.textModal ? renderTextModal() : '') + (ui.toast ? `<div class="toast" role="status">${esc(ui.toast)}</div>` : '');
    document.body.dataset.view = ui.view;
    if (document.body.dataset.screen !== screen) window.scrollTo({ top: 0, behavior: 'instant' });
    document.body.dataset.screen = screen;
    const modals = app.querySelectorAll('.modal-back');
    const dialog = modals.length ? modals[modals.length - 1] : null;
    for (const child of app.children) child.inert = !!dialog && child !== dialog && !child.classList.contains('toast');
    for (const field of app.querySelectorAll('textarea')) {
      if (drafts.has(field.id)) field.value = drafts.get(field.id);
      if (!field.closest('label') && !app.querySelector(`label[for="${field.id}"]`)) {
        const section = field.closest('.modal, .request');
        field.setAttribute('aria-label', section?.querySelector('.prompt, h2')?.textContent || 'Твоя запись');
      }
    }
    const target = dialog?.querySelector('textarea[autofocus], button') || app.querySelector('textarea[autofocus]');
    if (target && (dialog || window.innerWidth > 700)) target.focus({ preventScroll: true });
  }
  let toastTimer = null;
  function toast(msg) {
    ui.toast = msg; render();
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { ui.toast = null; render(); }, 3200);
  }

  function renderTopbar(g) {
    return `<header class="topbar">
      <button class="brand" data-act="home" aria-label="Experience, на главную">${icon('eye')}<span>${esc(D.TITLE)}<small>ИГРА-ПУТЬ К ОСОЗНАНИЮ</small></span></button>
      <nav aria-label="Главная навигация">
        ${g && (g.phase === 'play' || g.phase === 'entry') && ui.view !== 'game' ? '<button class="btn small" data-act="continue">Продолжить игру</button>' : ''}
        <button class="btn small ghost nav-diary ${ui.view === 'diary' ? 'active' : ''}" data-act="diary" aria-label="Мой дневник">${icon('book')}<span>Мой дневник</span>${store.games.length ? `<span class="nav-count">${store.games.length}</span>` : ''}</button>
        <button class="btn small ghost nav-rules" data-act="rules"><span class="help-icon" aria-hidden="true">?</span>Как играть</button>
      </nav></header>`;
  }

  function renderHome() {
    const g = activeGame();
    const unfinished = g && g.phase !== 'finished' && g.phase !== 'exited';
    return renderTopbar(g) + `<main class="home">
      <section class="hero">
        <div class="hero-copy">
          <p class="eyebrow"><span></span> ТРАНСФОРМАЦИОННАЯ ИГРА</p>
          <h1>Путь к себе<br>начинается <em>здесь.</em></h1>
          <p class="lead">Остановись. Услышь своё желание.<br>Пройди через образы, чувства и открытия<br class="desktop-br"> к тому, что по-настоящему важно.</p>
          <div class="hero-actions">
            <button class="btn primary big" data-act="${unfinished ? 'continue' : 'new'}">${unfinished ? 'Продолжить мой путь' : 'Начать свой путь'}${icon('arrow')}</button>
            <button class="btn ghost" data-act="${unfinished ? 'new' : 'rules'}">${unfinished ? 'Новая игра' : 'Познакомиться с игрой'}<span aria-hidden="true">↗</span></button>
          </div>
          ${unfinished && g.request.text ? `<p class="resume-note">Твой запрос: «${esc(g.request.text)}»</p>` : '<p class="hero-note">В своём темпе. С вниманием к себе.</p>'}
          <div class="element-strip" aria-label="Четыре стихии">${['air','water','fire','earth'].map(k => `<span>${icon(k)}${esc(D.ELEMENTS[k].name)}</span>`).join('')}</div>
        </div>
        <div class="hero-art" aria-hidden="true">
          <img class="hero-illustration" src="${ASSET('assets/hero-experience.jpg')}" alt="" width="1254" height="1254" fetchpriority="high">
          <span class="art-caption art-caption-top">ЧЕТЫРЕ СТИХИИ · ОДИН ТВОЙ ПУТЬ</span>
          <div class="art-note">${icon('star')}<span>Ответы ближе,<br><em>чем кажется.</em></span></div>
        </div>
      </section>
      <section class="journey" aria-labelledby="journey-title">
        <div class="section-heading"><p class="eyebrow">КАК РОЖДАЁТСЯ ТВОЙ ПУТЬ</p><h2 id="journey-title">Четыре шага навстречу себе</h2><span class="section-flower" aria-hidden="true">✳</span></div>
        <div class="how">
          <div class="how-item"><span class="step-num">01</span><div><h3>Сформулируй запрос</h3><p>Чего ты хочешь на самом деле? Дай своему желанию слова.</p></div></div>
          <div class="how-item"><span class="step-num">02</span><div><h3>Открой свою стихию</h3><p>Вытащи карту и узнай, какие качества поддержат тебя в пути.</p></div></div>
          <div class="how-item"><span class="step-num">03</span><div><h3>Следуй за открытиями</h3><p>Исследуй образы, находи ресурсы и прокладывай путь к Оку.</p></div></div>
          <div class="how-item"><span class="step-num">04</span><div><h3>Сохрани главное</h3><p>Твои карты и осознания останутся в личном дневнике.</p></div></div>
        </div>
      </section>
    </main>${footer()}`;
  }

  function renderRequest(g) {
    const r = g.request;
    let body = '';
    const progress = (k) => `<div class="steps-dots" aria-label="Этапы подготовки">${['Запрос', 'Уточнение', 'Подтверждение'].map((s, i) => `<span class="${i === k ? 'on' : i < k ? 'done' : ''}" ${i === k ? 'aria-current="step"' : ''}><i>${i < k ? '✓' : '0' + (i + 1)}</i>${s}</span>`).join('')}</div>`;
    if (g.step === 'ask') {
      body = progress(0) + `<h2>Что ты сегодня хочешь?</h2>
        <p class="lead">Прислушайся к себе. Сформулируй желание через то, что хочешь <b>получить</b> и привнести в свою жизнь.</p>
        <label class="lbl-small" for="req">МОЁ ЖЕЛАНИЕ</label><textarea id="req" rows="4" autofocus placeholder="Я хочу…">${esc(r.text)}</textarea>
        <p class="field-hint">Например: «Хочу найти дело, которое меня вдохновляет».</p>
        <div class="actions"><button class="btn primary" data-act="req-next">Продолжить ${icon('arrow')}</button><span class="note">Здесь нет правильных ответов. Только твои.</span></div>`;
    } else if (g.step === 'neg') {
      body = progress(0) + `<h2>Давай переформулируем</h2>
        <p class="lead">В твоей формулировке звучит отрицание или избавление: «${esc(r.text)}». Игра работает с желанием <b>получить</b> что-то. Подумай: что ты хочешь получить вместо этого? Как будет выглядеть твоя жизнь, когда это случится?</p>
        ${r.negWarn >= 2 ? '<p class="note">Если ты уверен(а), что формулировка созидательная, можно оставить её как есть.</p>' : ''}
        <textarea id="req" rows="4" autofocus placeholder="Я хочу получить…">${esc(r.text)}</textarea>
        <div class="actions"><button class="btn primary" data-act="neg-next">Дальше</button>${r.negWarn >= 2 ? '<button class="btn ghost" data-act="neg-keep">Оставить как есть</button>' : ''}</div>`;
    } else if (/^q\d+$/.test(g.step)) {
      const i = +g.step.slice(1);
      body = progress(1) + `<p class="req-quote">«${esc(r.text)}»</p>
        <h2>${esc(D.REQUEST_QUESTIONS[i])}</h2>
        <p class="note">Вопрос ${i + 1} из ${D.REQUEST_QUESTIONS.length}. Отвечай так, как чувствуешь, — это поможет понять, чего ты хочешь на самом деле.</p>
        <textarea id="ans" rows="4" autofocus>${esc(r.answers[i] || '')}</textarea>
        <div class="actions"><button class="btn primary" data-act="q-next" data-i="${i}">Дальше</button><button class="btn ghost" data-act="q-back" data-i="${i}">Назад</button></div>`;
    } else if (g.step === 'confirm') {
      body = progress(2) + `<h2>Это точно то, чего ты хочешь?</h2>
        <p class="req-quote big">«${esc(r.text)}»</p>
        <dl class="qa">${D.REQUEST_QUESTIONS.map((q, i) => `<dt>${esc(q)}</dt><dd>${nl2br(r.answers[i] || '—')}</dd>`).join('')}</dl>
        <div class="actions"><button class="btn primary" data-act="confirm-yes">Да, это то, что я хочу — войти в игру</button><button class="btn ghost" data-act="confirm-no">Хочу переформулировать</button></div>`;
    }
    return renderTopbar(g) + `<main class="request-view"><aside class="request-aside"><p class="eyebrow">НАЧАЛО ПУТИ</p><div class="request-symbol">${icon('eye')}</div><h2>Всё начинается<br>с <em>твоего желания.</em></h2><p>Позволь себе немного тишины.<br>Это время только для тебя.</p><div class="aside-line"></div><span class="note">${icon('lock')} Ответы сохраняются в этом браузере</span></aside><section class="panel-card request">${body}</section></main>${footer()}`;
  }

  function highlightMap(g) {
    const m = new Map();
    if (g.phase !== 'play') return m;
    if (g.pending && g.pending.type === 'direction') directionCells(g).forEach(d => m.set(d.cell, 'dir'));
    else if (!g.pending) { const s = nextSlot(g); if (s.ok) m.set(s.cell, 'next'); }
    return m;
  }
  function renderBoard(g) {
    const hl = highlightMap(g);
    let cells = '';
    for (const c of G.cells) {
      const cls = ['cell']; if (hl.has(c.id)) cls.push(hl.get(c.id));
      cells += `<polygon class="${cls.join(' ')}" data-cell="${c.id}" points="${c.pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')}"/>`;
    }
    const s = G.A * 720 / 677;
    let toks = '', cur = '';
    g.path.forEach((p, i) => {
      const c = G.cells[p.cell];
      const last = i === g.path.length - 1;
      toks += `<image class="tok${last ? ' last' : ''}" href="${tokenImg(p.token)}" x="${(c.cx - s / 2).toFixed(1)}" y="${(c.cy - s / 2).toFixed(1)}" width="${s.toFixed(1)}" height="${s.toFixed(1)}" transform="rotate(${p.rot.toFixed(1)} ${c.cx.toFixed(1)} ${c.cy.toFixed(1)})"/>`;
      if (last) cur = `<polygon class="cur" points="${c.pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')}"/>`;
    });
    const corners = Object.values(G.CORNERS).map(c => c.v);
    const outline = corners.map(([i,j]) => `${G.CX + (i + j / 2) * G.A},${G.CY + j * G.H}`).join(' ');
    const grid = G.cells.map(c => `<polygon points="${c.pts.map(p => p.join(',')).join(' ')}" fill="${isEye(c.id) ? '#345148' : c.up ? '#1b342e' : '#172e28'}" stroke="#aa966449" stroke-width="2"/><path d="${c.pts.map(p => `M${c.cx},${c.cy}L${p[0]},${p[1]}`).join('')}" fill="none" stroke="#a5916019" stroke-width="1.5"/>`).join('');
    const markers = Object.entries(G.CORNERS).map(([key, {v}]) => {
      const x = G.CX + (v[0] + v[1] / 2) * G.A * .86, y = G.CY + v[1] * G.H * .86;
      const color = ({air:'#c4d1bf',water:'#85b8b1',fire:'#d39a76',earth:'#c5b680'})[key] || '#bca475';
      return `<g transform="translate(${x} ${y})" color="${color}"><circle r="77" fill="#11251f" stroke="currentColor" stroke-width="2"/><circle r="67" fill="none" stroke="currentColor" stroke-opacity=".25" stroke-width="1"/><svg x="-34" y="-34" width="68" height="68" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round">${ICONS[key] || '<circle cx="12" cy="12" r="8"/><path d="M7 12h10m-4-4 4 4-4 4"/>'}</svg></g>`;
    }).join('');
    return `<svg class="board" viewBox="0 0 ${G.IMG_W} ${G.IMG_H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Игровое поле, четыре стихии и Око в центре">
      <polygon points="${outline}" fill="#132821" stroke="#c4ab70" stroke-width="14" stroke-linejoin="round"/>
      <g>${grid}</g><polygon points="${outline}" fill="none" stroke="#c4ab7099" stroke-width="3"/>
      ${markers}<g transform="translate(${G.CX} ${G.CY})" color="#d7c18d"><circle r="153" fill="#10261f" stroke="currentColor" stroke-width="2"/><circle r="139" fill="none" stroke="currentColor" stroke-opacity=".35" stroke-width="1"/>
      <path d="M-108 0Q0-105 108 0Q0 105-108 0Z" fill="#263e30" stroke="currentColor" stroke-width="3"/><circle r="41" fill="#c4ab70"/><circle r="25" fill="#12261f"/><circle cx="10" cy="-12" r="8" fill="#f0e4c2"/>
      <path d="M0-113v21m0 184v21m-85-192 14 14m142 142 14 14M85-79 71-65M-71 65l-14 14" stroke="currentColor" stroke-width="2"/></g>
      <g class="toks">${toks}</g>${cur}<g class="cells">${cells}</g></svg>`;
  }

  function renderHand(g) {
    if (!g.hand.length) return `<div class="hand-empty">${icon('star')}<p>Здесь появятся твои карты<span>Возьми первую и доверься пути.</span></p></div>`;
    return `<div class="hand">${g.hand.map(t => {
      const tok = D.TOKENS[t];
      const chk = g.phase === 'play' && !g.pending ? canPlay(g, t) : { ok: false };
      const cls = ['hand-card']; if (chk.ok) cls.push('ok'); if (ui.selected === t) cls.push('sel'); if (ui.flash === t) cls.push('flash');
      const dir = tok.exit === 'free' ? 'выбор' : DIR_TEXT[tok.exit];
      return `<button class="${cls.join(' ')}" data-act="select" data-token="${t}" title="${esc(tok.name)}" aria-pressed="${ui.selected === t}"><img src="${tokenImg(t)}" alt=""><span class="hc-name">${esc(tok.name)}</span><span class="hc-dir">${tok.exit === 'right' ? '↗ ' : tok.exit === 'left' ? '↖ ' : '↔ '}${dir}</span></button>`;
    }).join('')}</div>`;
  }

  function renderGame(g) {
    const el = g.element ? D.ELEMENTS[g.element] : null;
    let status = '', actions = '';
    if (g.phase === 'entry') {
      if (g.step === 'rethink') {
        status = `<h3>Три попытки — стихия не открылась</h3><p>Давай подумаем над запросом глубже. Ответь на вопросы — возможно, за этим желанием стоит другой запрос.</p>
          ${D.RETHINK_QUESTIONS.map((q, i) => `<label class="lbl">${esc(q)}<textarea id="rt${i}" rows="2"></textarea></label>`).join('')}
          <label class="lbl">Твой запрос (можно изменить формулировку)<textarea id="req" rows="3">${esc(g.request.text)}</textarea></label>
          <div class="actions"><button class="btn primary" data-act="rethink-done">Продолжить вытаскивать карты</button></div>`;
      } else {
        status = `<h3>Вход в игру</h3><p>Чтобы войти на поле, нужно вытащить <b>карту стихии</b>. Остальные карты уходят в резерв — ими ты потом будешь прокладывать путь.</p><p class="note">Попыток: ${g.attempts % 3} из 3</p>`;
        actions = `<button class="btn primary big" data-act="entry-draw">Вытащить карту <small>в мешочке ${g.bag.length}</small></button>`;
      }
    } else {
      const playable = playableTokens(g);
      if (g.pending && g.pending.type === 'direction') status = `<h3>Выбери направление</h3><p>Нажми на подсвеченную клетку поля — туда ляжет следующая карта. Или выбери здесь:</p><div class="actions">${directionCells(g).map(d => `<button class="btn primary" data-act="dir" data-cell="${d.cell}">${d.side === 'right' ? 'Направо' : 'Налево'}</button>`).join('')}</div>`;
      else if (!g.pending) {
        if (playable.length) status = `<h3>Твой ход</h3><p>Выбери карту из резерва и пойди ею. Карта ложится на подсвеченную клетку; её стрелка задаёт направление дальше.</p>`;
        else if (!g.hand.length && !g.drew) status = `<h3>Твой ход</h3><p>Резерв пуст — возьми новую карту из мешочка.</p>`;
        else if (!g.drew) status = `<h3>Твой ход</h3><p>В резерве нет подходящей карты. Возьми новую карту из мешочка.</p>`;
        else status = `<h3>Карты не подходят</h3><p>Ни одна карта из резерва здесь не ложится. Заверши ход — в следующем ходу можно взять ещё одну карту.</p>`;
        const sel = ui.selected != null && g.hand.includes(ui.selected) ? ui.selected : null;
        if (sel != null) {
          const tok = D.TOKENS[sel]; const chk = canPlay(g, sel);
          status += `<div class="sel-info"><img src="${tokenImg(sel)}" alt=""><div><b>${esc(tok.name)}</b><p>${esc(tok.desc)}</p>${chk.ok ? `<button class="btn primary" data-act="play" data-token="${sel}">Пойти этой картой</button>` : `<p class="warn">${esc(chk.reason)}</p>`}</div></div>`;
        }
        const canDraw = !g.drew && (g.bag.length || g.path.length > 3);
        actions = `<button class="btn ${playable.length ? '' : 'primary'}" data-act="draw" ${canDraw ? '' : 'disabled'}>Взять карту <small>в мешочке ${g.bag.length}</small></button>`;
        if (!playable.length && g.drew && (g.bag.length || g.path.length > 3)) actions += `<button class="btn primary" data-act="end-turn">Завершить ход</button>`;
        if (!playable.length && !canDraw) actions += `<button class="btn primary" data-act="step-back">Шаг назад</button>`;
      }
    }
    const steps = g.journal.filter(j => j.t === 'card').length;
    return renderTopbar(g) + `<main class="game">
      <div class="game-heading"><div><p class="eyebrow">${g.phase === 'entry' ? 'ЗНАКОМСТВО СО СТИХИЕЙ' : 'ПРОСТРАНСТВО ТВОИХ ОТКРЫТИЙ'}</p><h1>${g.phase === 'entry' ? 'Пусть путь откроется' : 'Твой путь к осознанию'}</h1></div><span class="session-status"><i></i> Сохраняется в дневнике</span></div>
      <div class="board-wrap"><div class="board-heading"><span>ПОЛЕ СОЗНАНИЯ</span><span>ШАГ <b>${pad2(steps)}</b></span></div>${renderBoard(g)}<div class="board-legend"><span><i></i> ${g.pending && g.pending.type === 'direction' ? 'Выбери подсвеченное направление' : g.phase === 'entry' ? 'Четыре стихии. Твой уникальный путь.' : 'Подсвеченная клетка ждёт твою карту'}</span><span>${icon('eye')} Цель пути</span></div></div>
      <aside class="panel">
        <div class="req-box"><span class="lbl-small">Запрос</span><p>${esc(g.request.text)}</p></div>
        ${el ? `<div class="el-box" style="--el:${el.color}">${icon(g.element)}<div><span class="lbl-small">Твоя стихия</span><b>${esc(el.name)}</b> <span class="note">· ${esc(el.short)}</span></div></div>` : ''}
        <div class="status">${status}${actions ? `<div class="actions">${actions}</div>` : ''}</div>
        <div class="hand-box"><span class="lbl-small">Резерв карт${g.hand.length ? ` (${g.hand.length})` : ''}</span>${renderHand(g)}</div>
        <div class="journal-mini">${icon('book')}<div><span class="lbl-small">Твои открытия</span><p>Шагов пути: ${steps}</p></div><button class="btn small ghost" data-act="sheet" data-id="${g.id}" aria-label="Открыть маршрутный лист">${icon('arrow')}</button></div>
      </aside></main>${footer()}`;
  }

  function cardBlock(rec) {
    if (!rec.card) return '';
    const kind = rec.kind;
    let extra = '';
    if (kind === 'hint') extra = `<p class="hint-text">${esc(D.HINTS[rec.card - 1])}</p>`;
    return `<figure class="deck-card ${kind}"><img src="${cardImg(kind, rec.card)}" alt="${esc(D.DECKS[kind].name)} ${rec.card}"><figcaption>${esc(D.DECKS[kind].name)} · карта ${rec.card}</figcaption></figure>${extra}`;
  }

  function renderModal(g) {
    if (!g || !g.pending || ui.view !== 'game') return '';
    const p = g.pending;
    let inner = '';
    if (p.type === 'reserveInfo') {
      const tok = D.TOKENS[p.token];
      inner = `<h2>Карта «${esc(tok.name)}»</h2><img class="tok-big" src="${tokenImg(p.token)}" alt=""><p>Это не стихия — карта уходит в резерв. Ею ты будешь прокладывать путь, когда войдёшь в игру.</p><p class="note">${esc(tok.desc)}</p>
        <div class="actions"><button class="btn primary" data-act="modal-ok">Дальше</button></div>`;
    } else if (p.type === 'enterInfo') {
      const el = D.ELEMENTS[g.element];
      inner = `<h2>Стихия ${esc(el.gen)} — ты входишь в игру!</h2><img class="tok-big" src="${tokenImg(g.path[0].token)}" alt=""><p>${esc(el.desc)}</p><p class="note">Карта стихии легла на угол поля. Теперь выбери, в какую сторону начать путь.</p>
        <div class="actions"><button class="btn primary" data-act="enter-go">Начать путь</button></div>`;
    } else if (p.type === 'effect') {
      const rec = g.journal[p.j]; const tok = D.TOKENS[rec.token];
      const prompt = D.PROMPTS[rec.kind] || D.PROMPTS.path;
      const required = rec.kind === 'insight' || !!rec.card;
      let title = tok.name;
      if (rec.kind === 'element') title = 'Стихия ' + D.ELEMENTS[rec.element].gen;
      inner = `<h2>${esc(title)}</h2>${rec.card ? cardBlock(rec) : `<img class="tok-big" src="${tokenImg(rec.token)}" alt="">`}
        ${rec.kind === 'element' ? `<p class="note">Качества: ${esc(D.ELEMENTS[rec.element].qualities)}.</p>` : ''}
        <p class="prompt">${esc(prompt)}</p>
        <textarea id="note" rows="4" autofocus placeholder="${required ? 'Запиши свой ответ…' : 'Заметка по желанию…'}">${esc(rec.note)}</textarea>
        ${rec.dir ? `<p class="note">Следующая карта ляжет <b>${DIR_TEXT[rec.dir]}</b>.</p>` : '<p class="note">Направление дальше ты выберешь сам(а).</p>'}
        <div class="actions"><button class="btn primary" data-act="effect-save" data-required="${required ? 1 : 0}">Сохранить и продолжить</button></div>`;
    } else if (p.type === 'exitChoice') {
      inner = `<h2>Выход из игры</h2><img class="tok-big" src="${tokenImg(3)}" alt=""><p>${p.source === 'board' ? 'Твой путь привёл к точке выхода из игры.' : 'Тебе выпала карта «Выход».'} Ты можешь завершить путь сейчас — маршрут сохранится в дневнике — или остаться и продолжить идти к Оку.</p>
        <p class="prompt">${esc(D.PROMPTS.exitStay)}</p><textarea id="note" rows="3" placeholder="Заметка по желанию…"></textarea>
        <div class="actions"><button class="btn primary" data-act="exit-stay">Остаться на пути</button><button class="btn ghost" data-act="exit-leave">Выйти из игры</button></div>`;
    } else if (p.type === 'back') {
      inner = `<h2>Шаг назад</h2><p>${esc(D.PROMPTS.back)}</p>${p.removed ? `<p class="note">В мешочек вернулось карт: ${p.removed}.</p>` : ''}<textarea id="note" rows="3" placeholder="Заметка по желанию…"></textarea>
        <div class="actions"><button class="btn primary" data-act="back-save">Продолжить</button></div>`;
    } else if (p.type === 'finish') {
      inner = `<h2>Ты пришёл(ла) к Оку</h2><img class="tok-big" src="${tokenImg(1)}" alt=""><p>Путь пройден — ты дошёл(ла) до центра поля сознания, до осознания. Теперь вытащи карту напутствия.</p>
        <div class="actions"><button class="btn primary" data-act="finish-draw">Вытащить напутствие</button></div>`;
    } else if (p.type === 'finish2') {
      inner = `<h2>Напутствие</h2><blockquote class="parting">${esc(D.PARTING[g.finish.parting])}</blockquote>
        <p class="prompt">Твоё главное осознание на этом пути. Что ты понял(а) о том, как получить желаемое в жизни?</p>
        <textarea id="note" rows="5" autofocus placeholder="Запиши своё осознание…"></textarea>
        <div class="actions"><button class="btn primary" data-act="finish-done">Завершить игру</button></div>`;
    } else return '';
    return `<div class="modal-back"><section class="modal" role="dialog" aria-modal="true" aria-label="Карточка пути"><p class="eyebrow">${icon('star')} МОМЕНТ ДЛЯ СЕБЯ</p>${inner}</section></div>`;
  }

  function renderTextModal() {
    const t = ui.textModal;
    return `<div class="modal-back"><div class="modal" role="dialog" aria-modal="true" aria-label="Экспорт записей"><h2>${esc(t.name)}</h2><p class="note">В этой версии файл не скачивается — скопируй текст и сохрани его в заметки.</p><textarea id="text-out" rows="12" readonly>${esc(t.content)}</textarea><div class="actions"><button class="btn primary" data-act="text-copy">Скопировать</button><button class="btn ghost" data-act="text-close">Закрыть</button></div></div></div>`;
  }
  function renderRules() {
    return `<div class="modal-back" data-act="rules-close"><div class="modal rules" role="dialog" aria-modal="true" aria-label="Как играть" onclick="event.stopPropagation()"><p class="eyebrow">ПУТЕВОДИТЕЛЬ</p><button class="modal-close" data-act="rules-close" aria-label="Закрыть правила">×</button>
      <h2>Как играть</h2>
      <p><b>Смысл игры.</b> Всё, что прожито в нашем сознании, для нас как будто уже было. Ты формулируешь запрос — то, чего хочешь, — и проходишь путь к нему на поле сознания, проживая его. Чтобы потом реализовать в жизни.</p>
      <p><b>Поле.</b> Шестиугольное поле сознания. В центре — Око: символ осознания, конец игры. По углам — четыре стихии (Огонь, Вода, Земля, Воздух) и две точки выхода из игры.</p>
      <p><b>Запрос.</b> Желание формулируется как получение чего-то (не избавление). Игра задаёт уточняющие вопросы: если ты это получишь — что будет, что ты будешь чувствовать, что изменится.</p>
      <p><b>Вход.</b> Вытаскивай карты пути, пока не откроется карта стихии. Остальные карты уходят в резерв. После трёх неудачных попыток игра предлагает подумать над запросом глубже.</p>
      <p><b>Стихия.</b> Вода — путь глубокого чувствования, Огонь — активности и энергии, Воздух — трансформации и скорости, Земля — основательности. Карта стихии ложится на её угол поля.</p>
      <p><b>Путь.</b> Каждый ход: можно взять одну новую карту и нужно пойти одной картой из резерва. Карта ложится на следующую клетку; её стрелка указывает, куда ляжет следующая. У карт без стрелки направление выбираешь сам(а). Задача — привести дорожку к Оку, но путь может водить из стороны в сторону.</p>
      <p><b>Карты.</b> Препятствие, Ресурс и Подсказка открывают карту из своей колоды — запиши, что ты видишь на своём пути. Осознание — точка, где нужно записать, что ты уже понял(а). Карты пути просто прокладывают дорожку. Выход — можно завершить игру или остаться.</p>
      <p><b>Финал.</b> Когда дорожка приходит к Оку, ты получаешь напутствие и записываешь главное осознание. Игра сохраняет маршрутный лист: все карты и твои записи. Игру можно прервать и продолжить в другой день — всё сохраняется в этом браузере.</p>
      <div class="actions"><button class="btn primary" data-act="rules-close">Понятно</button></div></div></div>`;
  }

  function renderSheet(g) {
    if (!g) return renderTopbar(null) + '<main class="narrow"><p>Игра не найдена.</p></main>';
    const r = g.request; const el = g.element ? D.ELEMENTS[g.element] : null;
    const unfinished = g.phase !== 'finished' && g.phase !== 'exited';
    let items = '';
    for (const j of g.journal) {
      if (j.t === 'enter') items += `<div class="j enter"><div class="j-head"><img src="${tokenImg(j.token)}" alt=""><div><b>Вход в игру: стихия ${esc(D.ELEMENTS[j.element].name)}</b><span>${esc(D.ELEMENTS[j.element].short)}</span></div></div></div>`;
      else if (j.t === 'rethink') items += `<div class="j rethink"><b>Переосмысление запроса</b><dl class="qa">${D.RETHINK_QUESTIONS.map((q, i) => `<dt>${esc(q)}</dt><dd>${nl2br(j.answers[i] || '—')}</dd>`).join('')}</dl><p class="note">Запрос: «${esc(j.text)}»</p></div>`;
      else if (j.t === 'card') {
        const tok = D.TOKENS[j.token];
        let title = tok.name; if (j.kind === 'element') title = 'Стихия ' + D.ELEMENTS[j.element].gen;
        items += `<div class="j card ${j.kind}"><div class="j-head"><img src="${tokenImg(j.token)}" alt=""><div><b>Шаг ${j.step}. ${esc(title)}</b><span>${j.dir ? 'дальше ' + DIR_TEXT[j.dir] : ''}</span></div></div>${cardBlock(j)}${j.note ? `<p class="j-note">${nl2br(j.note)}</p>` : ''}</div>`;
      } else if (j.t === 'back') items += `<div class="j back"><b>Шаг назад</b>${j.removed ? `<span class="note"> — в мешочек вернулось карт: ${j.removed}</span>` : ''}${j.note ? `<p class="j-note">${nl2br(j.note)}</p>` : ''}</div>`;
      else if (j.t === 'exit') items += `<div class="j exit"><b>${j.choice === 'leave' ? 'Выход из игры' : 'Точка выхода: остался(ась) на пути'}</b>${j.note ? `<p class="j-note">${nl2br(j.note)}</p>` : ''}</div>`;
      else if (j.t === 'arrive') items += `<div class="j arrive"><b>Путь привёл к Оку — осознание</b></div>`;
      else if (j.t === 'finish') items += `<div class="j finish"><b>Напутствие</b><blockquote class="parting">${esc(D.PARTING[j.parting])}</blockquote><b>Главное осознание</b><p class="j-note">${nl2br(j.awareness)}</p></div>`;
    }
    return renderTopbar(activeGame()) + `<main class="narrow sheet-view">
      <section class="sheet">
        <div class="sheet-head"><span class="lbl-small">Маршрутный лист · ${esc(statusText(g))}</span><h2>«${esc(r.text)}»</h2><p class="note">${esc(fmtDate(g.createdAt))}${g.updatedAt - g.createdAt > 60000 ? ' — ' + esc(fmtDate(g.updatedAt)) : ''}</p></div>
        ${r.history.length ? `<p class="note">Первая формулировка: «${esc(r.history[0])}»</p>` : ''}
        <dl class="qa">${D.REQUEST_QUESTIONS.map((q, i) => `<dt>${esc(q)}</dt><dd>${nl2br(r.answers[i] || '—')}</dd>`).join('')}</dl>
        ${el ? `<div class="el-box" style="--el:${el.color}"><span class="lbl-small">Стихия</span><b>${esc(el.name)}</b> — ${esc(el.desc)}</div>` : ''}
        <div class="journal">${items || '<p class="note">Путь ещё не начат.</p>'}</div>
        <label class="lbl">Мои заметки и результаты<textarea id="notes" rows="4" placeholder="Что получилось, что изменилось, к чему хочу вернуться…">${esc(g.notes)}</textarea></label>
        <div class="actions no-print">
          ${unfinished ? `<button class="btn primary" data-act="open" data-id="${g.id}">Продолжить игру</button>` : ''}
          <button class="btn" data-act="print">Распечатать / сохранить PDF</button>
          <button class="btn" data-act="download" data-id="${g.id}">Скачать текстом</button>
          <button class="btn ghost" data-act="diary">В дневник</button>
        </div>
      </section></main>`;
  }

  function renderDiary() {
    const games = store.games.slice().sort((a, b) => b.updatedAt - a.updatedAt);
    return renderTopbar(activeGame()) + `<main class="narrow diary-view">
      <section class="panel-card diary">
        <p class="eyebrow">ЛИЧНОЕ ПРОСТРАНСТВО</p><h1>Мой дневник</h1>
        <p class="lead">Каждый путь оставляет что-то важное.</p><p class="note">Возвращайся к своим открытиям или продолжи с того места, где остановился.</p>
        ${games.length ? `<div class="list">${games.map((g,i) => `<div class="row"><span class="diary-number">${pad2(games.length-i)}</span><div class="row-main"><b>${esc(g.request.text || 'Запрос не сформулирован')}</b><span>${esc(fmtDate(g.updatedAt))} · ${esc(statusText(g))}${g.element ? ' · ' + esc(D.ELEMENTS[g.element].name) : ''} · шагов: ${g.journal.filter(j => j.t === 'card').length}</span></div><div class="row-actions">${ui.confirmDelete === g.id ? `<span class="note">Удалить эту игру?</span><button class="btn small danger" data-act="delete-yes" data-id="${g.id}">Да, удалить</button><button class="btn small ghost" data-act="delete-no">Нет</button>` : `<button class="btn small" data-act="open" data-id="${g.id}">${g.phase === 'finished' || g.phase === 'exited' ? 'Открыть' : 'Продолжить'}</button><button class="btn small ghost" data-act="sheet" data-id="${g.id}">Маршрут</button><button class="btn small ghost danger" data-act="delete" data-id="${g.id}">Удалить</button>`}</div></div>`).join('')}</div>` : `<div class="diary-empty">${icon('book')}<h2>Здесь начнётся твоя история</h2><p>Сделай первый шаг. Карты, мысли и открытия<br>соберутся в твой личный маршрут.</p></div>`}
        <div class="actions"><button class="btn primary" data-act="new">Начать новую игру</button><button class="btn ghost" data-act="export">Скачать резервную копию</button><label class="btn ghost file">Загрузить копию<input type="file" id="import" accept="application/json,.json"></label></div>
        <p class="storage-note">${icon('lock')} Дневник хранится на этом устройстве. Скачай копию, чтобы перенести его или сохранить отдельно.</p>
      </section></main>${footer()}`;
  }

  /* ---------------- экспорт ---------------- */
  function sheetText(g) {
    const r = g.request; const L = [];
    L.push(`${D.TITLE} — маршрутный лист`, `Дата: ${fmtDate(g.createdAt)}`, `Статус: ${statusText(g)}`, '', `ЗАПРОС: ${r.text}`);
    if (r.history.length) L.push(`Первая формулировка: ${r.history[0]}`);
    D.REQUEST_QUESTIONS.forEach((q, i) => L.push(`${q} — ${r.answers[i] || '—'}`));
    if (g.element) L.push('', `СТИХИЯ: ${D.ELEMENTS[g.element].name}. ${D.ELEMENTS[g.element].desc}`);
    L.push('', 'ПУТЬ:');
    for (const j of g.journal) {
      if (j.t === 'enter') L.push(`• Вход в игру: стихия ${D.ELEMENTS[j.element].name}`);
      else if (j.t === 'rethink') { L.push('• Переосмысление запроса:'); D.RETHINK_QUESTIONS.forEach((q, i) => L.push(`   ${q} — ${j.answers[i] || '—'}`)); L.push(`   Запрос: ${j.text}`); }
      else if (j.t === 'card') {
        const tok = D.TOKENS[j.token]; let title = tok.name; if (j.kind === 'element') title = 'Стихия ' + D.ELEMENTS[j.element].gen;
        L.push(`• Шаг ${j.step}. ${title}${j.dir ? ' (дальше ' + DIR_TEXT[j.dir] + ')' : ''}${j.card ? ` — ${D.DECKS[j.kind].name} №${j.card}` : ''}`);
        if (j.kind === 'hint' && j.card) L.push(`   Подсказка: ${D.HINTS[j.card - 1]}`);
        if (j.note) L.push(`   Запись: ${j.note}`);
      } else if (j.t === 'back') { L.push(`• Шаг назад${j.removed ? ' (карт вернулось: ' + j.removed + ')' : ''}`); if (j.note) L.push(`   Запись: ${j.note}`); }
      else if (j.t === 'exit') { L.push(`• ${j.choice === 'leave' ? 'Выход из игры' : 'Точка выхода — остался(ась) на пути'}`); if (j.note) L.push(`   Запись: ${j.note}`); }
      else if (j.t === 'arrive') L.push('• Путь привёл к Оку — осознание');
      else if (j.t === 'finish') L.push('', `НАПУТСТВИЕ: ${D.PARTING[j.parting]}`, `ГЛАВНОЕ ОСОЗНАНИЕ: ${j.awareness}`);
    }
    if (g.notes) L.push('', `МОИ ЗАМЕТКИ: ${g.notes}`);
    return L.join('\n');
  }
  function downloadFile(name, content, type) {
    if (window.ASSETS) { ui.textModal = { name, content }; render(); return; }
    const blob = new Blob([content], { type });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ---------------- действия ---------------- */
  function startNew() {
    const g = newGame(); store.games.push(g); store.activeId = g.id; save();
    ui.view = 'game'; ui.selected = null;
  }
  function openGame(id) {
    const g = gameById(id); if (!g) return;
    if (g.phase === 'finished' || g.phase === 'exited') { ui.view = 'sheet'; ui.sheetId = id; }
    else { store.activeId = id; save(); ui.view = 'game'; }
  }
  const val = id => { const e = $('#' + id); return e ? e.value.trim() : ''; };

  document.addEventListener('click', (e) => {
    const cellEl = e.target.closest('polygon[data-cell]');
    const g = activeGame();
    if (cellEl && g && ui.view === 'game' && g.pending && g.pending.type === 'direction') {
      chooseDirection(g, +cellEl.dataset.cell); render(); return;
    }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    switch (act) {
      case 'home': ui.view = 'home'; break;
      case 'diary': ui.view = 'diary'; break;
      case 'rules': ui.rules = true; break;
      case 'rules-close': ui.rules = false; break;
      case 'new': startNew(); break;
      case 'continue': if (g) ui.view = 'game'; else startNew(); break;
      case 'open': openGame(btn.dataset.id); break;
      case 'sheet': ui.view = 'sheet'; ui.sheetId = btn.dataset.id; break;
      case 'delete': ui.confirmDelete = btn.dataset.id; break;
      case 'delete-no': ui.confirmDelete = null; break;
      case 'delete-yes': { store.games = store.games.filter(x => x.id !== btn.dataset.id); if (store.activeId === btn.dataset.id) store.activeId = null; ui.confirmDelete = null; save(); break; }
      case 'text-close': ui.textModal = null; break;
      case 'text-copy': { const ta = $('#text-out'); if (ta) { ta.select(); try { navigator.clipboard.writeText(ta.value); } catch (err) { document.execCommand('copy'); } toast('Скопировано.'); } return; }
      case 'export': downloadFile(`experience-diary-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(store, null, 2), 'application/json'); return;
      case 'print': window.print(); return;
      case 'download': { const gg = gameById(btn.dataset.id); if (gg) downloadFile(`experience-route-${new Date(gg.createdAt).toISOString().slice(0, 10)}.txt`, sheetText(gg), 'text/plain;charset=utf-8'); return; }
      /* запрос */
      case 'req-next': { const t = val('req'); if (!t) { toast('Напиши, чего ты хочешь.'); return; } g.request.text = t; if (isNegative(t) && g.request.negWarn < 1) { g.request.negWarn = 1; g.step = 'neg'; } else g.step = 'q0'; touch(g); break; }
      case 'neg-next': { const t = val('req'); if (!t) { toast('Напиши формулировку.'); return; } if (t !== g.request.text) g.request.history.push(g.request.text); g.request.text = t; if (isNegative(t) && g.request.negWarn < 2) { g.request.negWarn = 2; g.step = 'neg'; } else g.step = 'q0'; touch(g); break; }
      case 'neg-keep': { const t = val('req'); if (t && t !== g.request.text) { g.request.history.push(g.request.text); g.request.text = t; } g.step = 'q0'; touch(g); break; }
      case 'q-next': { const i = +btn.dataset.i; const a = val('ans'); if (!a) { toast('Ответь на вопрос — хотя бы коротко.'); return; } g.request.answers[i] = a; g.step = i + 1 < D.REQUEST_QUESTIONS.length ? 'q' + (i + 1) : 'confirm'; touch(g); break; }
      case 'q-back': { const i = +btn.dataset.i; g.request.answers[i] = val('ans'); g.step = i > 0 ? 'q' + (i - 1) : 'ask'; touch(g); break; }
      case 'confirm-yes': g.phase = 'entry'; g.step = 'draw'; touch(g); break;
      case 'confirm-no': g.step = 'ask'; touch(g); break;
      /* вход */
      case 'entry-draw': entryDraw(g); break;
      case 'modal-ok': { g.pending = null; if (g.phase === 'entry' && g.attempts > 0 && g.attempts % 3 === 0) g.step = 'rethink'; touch(g); break; }
      case 'rethink-done': { const answers = D.RETHINK_QUESTIONS.map((q, i) => val('rt' + i)); const t = val('req') || g.request.text; if (t !== g.request.text) { g.request.history.push(g.request.text); g.request.text = t; } g.request.rethinks.push({ answers, text: t }); g.journal.push({ t: 'rethink', answers, text: t, ts: Date.now() }); g.step = 'draw'; touch(g); break; }
      case 'enter-go': g.pending = { type: 'direction' }; touch(g); break;
      /* путь */
      case 'select': { const t = +btn.dataset.token; ui.selected = ui.selected === t ? null : t; ui.flash = null; break; }
      case 'play': placeCard(g, +btn.dataset.token); break;
      case 'dir': chooseDirection(g, +btn.dataset.cell); break;
      case 'draw': drawCard(g); break;
      case 'end-turn': endTurn(g); break;
      case 'step-back': stepBack(g); break;
      case 'effect-save': { const rec = g.journal[g.pending.j]; const n = val('note'); if (btn.dataset.required === '1' && !n) { toast('Запиши свой ответ — это важная часть маршрута.'); return; } rec.note = n; afterEffect(g); touch(g); break; }
      case 'exit-stay': {
        const note = val('note'); g.journal.push({ t: 'exit', choice: 'stay', note, ts: Date.now() });
        if (g.pending.source === 'board') {
          const popped = g.path.pop(); g.bag.push(popped.token);
          while (g.path.length > 1 && D.TOKENS[g.path[g.path.length - 1].token].exit !== 'free') { const p2 = g.path.pop(); g.bag.push(p2.token); }
          const nl = g.path[g.path.length - 1]; nl.exitEdge = null; nl.choice = null; nl.rot = rotFor(nl.token, nl.cell, nl.entryEdge, null);
          g.bag = shuffle(g.bag); g.pending = { type: 'direction' };
          if (!directionCells(g).length) stepBack(g);
        } else afterEffect(g);
        touch(g); break;
      }
      case 'exit-leave': { const note = val('note'); g.journal.push({ t: 'exit', choice: 'leave', note, ts: Date.now() }); g.phase = 'exited'; g.pending = null; touch(g); ui.view = 'sheet'; ui.sheetId = g.id; break; }
      case 'back-save': { const note = val('note'); g.journal.push({ t: 'back', removed: g.pending.removed, note, ts: Date.now() }); const last = g.path[g.path.length - 1]; g.pending = last.exitEdge == null ? { type: 'direction' } : null; g.drew = false; touch(g); break; }
      case 'finish-draw': { if (!g.decks.parting.length) g.decks.parting = shuffle(D.range(0, D.PARTING.length - 1)); g.finish = { parting: g.decks.parting.shift() }; g.pending = { type: 'finish2' }; touch(g); break; }
      case 'finish-done': { const a = val('note'); if (!a) { toast('Запиши своё главное осознание.'); return; } g.finish.awareness = a; g.finish.ts = Date.now(); g.journal.push({ t: 'finish', parting: g.finish.parting, awareness: a, ts: Date.now() }); g.phase = 'finished'; g.pending = null; touch(g); ui.view = 'sheet'; ui.sheetId = g.id; break; }
      default: return;
    }
    render();
  });
  document.addEventListener('input', (e) => {
    if (e.target.id === 'notes' && ui.view === 'sheet') { const gg = gameById(ui.sheetId); if (gg) { gg.notes = e.target.value; touch(gg); } }
  });
  document.addEventListener('change', (e) => {
    if (e.target.id === 'import' && e.target.files[0]) {
      const f = e.target.files[0]; const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          if (!data || !Array.isArray(data.games)) throw new Error('bad');
          let added = 0;
          for (const g of data.games) if (!gameById(g.id)) { store.games.push(g); added++; }
          save(); toast(`Загружено игр: ${added}.`); render();
        } catch (err) { toast('Не удалось прочитать файл.'); }
      };
      reader.readAsText(f);
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && ui.rules) { ui.rules = false; render(); return; }
    if (e.key !== 'Tab') return;
    const dialog = [...app.querySelectorAll('.modal-back')].pop();
    if (!dialog) return;
    const focusable = [...dialog.querySelectorAll('button, textarea, input, a[href]')].filter(el => !el.disabled);
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  render();
})();
