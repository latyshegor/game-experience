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
  const tokenImg = id => `assets/tokens/${pad2(id)}.webp`;
  const cardImg = (kind, n) => `${D.DECKS[kind].dir}/${pad2(n)}.webp`;
  const DIR_TEXT = { right: 'направо', left: 'налево' };

  /* ---------------- хранилище ---------------- */
  let store = loadStore();
  function loadStore() {
    try { const s = JSON.parse(localStorage.getItem(STORAGE_KEY)); if (s && Array.isArray(s.games)) return s; } catch (e) { /* пусто */ }
    return { games: [], activeId: null };
  }
  function save() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); } catch (e) { console.warn('save failed', e); } }
  const ui = { view: 'home', selected: null, sheetId: null, flash: null, rules: false, toast: null };
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
    app.innerHTML = html + renderModal(g) + (ui.rules ? renderRules() : '') + (ui.toast ? `<div class="toast">${esc(ui.toast)}</div>` : '');
    document.body.dataset.view = ui.view;
    const ta = app.querySelector('textarea[autofocus]');
    if (ta && window.innerWidth > 700) ta.focus();
  }
  let toastTimer = null;
  function toast(msg) {
    ui.toast = msg; render();
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { ui.toast = null; render(); }, 3200);
  }

  function renderTopbar(g) {
    return `<header class="topbar">
      <button class="brand" data-act="home"><span class="brand-eye"></span>${esc(D.TITLE)}</button>
      <nav>
        ${g && (g.phase === 'play' || g.phase === 'entry') && ui.view !== 'game' ? '<button class="btn small" data-act="continue">Продолжить игру</button>' : ''}
        <button class="btn small ghost" data-act="diary">Дневник</button>
        <button class="btn small ghost" data-act="rules">Как играть</button>
      </nav></header>`;
  }

  function renderHome() {
    const g = activeGame();
    const unfinished = g && g.phase !== 'finished' && g.phase !== 'exited';
    return renderTopbar(g) + `<main class="home">
      <div class="hero">
        <div class="hero-eye"><img src="assets/tokens/01.webp" alt=""></div>
        <h1>${esc(D.TITLE)}</h1>
        <p class="tagline">Игра-путь к осознанию</p>
        <p class="lead">Всё, что прожито в нашем сознании, для нас как будто уже было. Сформулируй запрос, войди на поле сознания и пройди путь к своей цели — чтобы потом реализовать его в жизни.</p>
        <div class="actions column">
          ${unfinished ? `<button class="btn primary big" data-act="continue">Продолжить игру<small>${esc(g.request.text || 'запрос ещё не сформулирован')}</small></button>` : ''}
          <button class="btn ${unfinished ? '' : 'primary'} big" data-act="new">Начать новую игру</button>
          <button class="btn ghost" data-act="diary">Мой дневник${store.games.length ? ` (${store.games.length})` : ''}</button>
          <button class="btn ghost" data-act="rules">Как играть</button>
        </div>
      </div>
      <section class="how">
        <div class="how-item"><b>1. Запрос</b><span>Игра поможет сформулировать желание в созидательном ключе и уточнить его.</span></div>
        <div class="how-item"><b>2. Вход</b><span>Вытаскивай карты, пока не откроется стихия — она задаёт характер пути.</span></div>
        <div class="how-item"><b>3. Путь</b><span>Прокладывай дорожку карт по стрелкам к Оку: препятствия, ресурсы, подсказки, осознания.</span></div>
        <div class="how-item"><b>4. Маршрут</b><span>В конце — напутствие и маршрутный лист со всеми картами и твоими записями.</span></div>
      </section>
    </main>`;
  }

  function renderRequest(g) {
    const r = g.request;
    let body = '';
    const progress = (k) => `<div class="steps-dots">${['Запрос', 'Уточнение', 'Подтверждение'].map((s, i) => `<span class="${i === k ? 'on' : i < k ? 'done' : ''}">${s}</span>`).join('')}</div>`;
    if (g.step === 'ask') {
      body = progress(0) + `<h2>Что ты сегодня хочешь?</h2>
        <p class="lead">Сформулируй желание как <b>получение</b> чего-то, а не как избавление от чего-то. Например: «Хочу решить вопрос с жильём», «Хочу достичь таких-то результатов в бизнесе», «Хочу выйти замуж», «Хочу наладить отношения с близкими».</p>
        <textarea id="req" rows="4" autofocus placeholder="Я хочу…">${esc(r.text)}</textarea>
        <div class="actions"><button class="btn primary" data-act="req-next">Дальше</button></div>`;
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
    return renderTopbar(g) + `<main class="narrow"><section class="panel-card request">${body}</section></main>`;
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
    return `<svg class="board" viewBox="0 0 ${G.IMG_W} ${G.IMG_H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Игровое поле">
      <image href="assets/board.webp" width="${G.IMG_W}" height="${G.IMG_H}"/>
      <g class="toks">${toks}</g>${cur}<g class="cells">${cells}</g></svg>`;
  }

  function renderHand(g) {
    if (!g.hand.length) return '<p class="note">Резерв пуст.</p>';
    return `<div class="hand">${g.hand.map(t => {
      const tok = D.TOKENS[t];
      const chk = g.phase === 'play' && !g.pending ? canPlay(g, t) : { ok: false };
      const cls = ['hand-card']; if (chk.ok) cls.push('ok'); if (ui.selected === t) cls.push('sel'); if (ui.flash === t) cls.push('flash');
      const dir = tok.exit === 'free' ? 'выбор' : DIR_TEXT[tok.exit];
      return `<button class="${cls.join(' ')}" data-act="select" data-token="${t}" title="${esc(tok.name)}"><img src="${tokenImg(t)}" alt=""><span class="hc-name">${esc(tok.name)}</span><span class="hc-dir">${dir}</span></button>`;
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
      <div class="board-wrap">${renderBoard(g)}</div>
      <aside class="panel">
        <div class="req-box"><span class="lbl-small">Запрос</span><p>${esc(g.request.text)}</p></div>
        ${el ? `<div class="el-box" style="--el:${el.color}"><span class="lbl-small">Стихия</span><b>${esc(el.name)}</b> — ${esc(el.short)}</div>` : ''}
        <div class="status">${status}</div>
        <div class="hand-box"><span class="lbl-small">Резерв карт${g.hand.length ? ` (${g.hand.length})` : ''}</span>${renderHand(g)}</div>
        <div class="actions">${actions}</div>
        <div class="journal-mini"><span class="lbl-small">Маршрут</span><p>Шагов пути: ${steps}</p><button class="btn small ghost" data-act="sheet" data-id="${g.id}">Открыть маршрутный лист</button></div>
      </aside></main>`;
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
    return `<div class="modal-back"><div class="modal">${inner}</div></div>`;
  }

  function renderRules() {
    return `<div class="modal-back" data-act="rules-close"><div class="modal rules" onclick="event.stopPropagation()">
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
    return renderTopbar(activeGame()) + `<main class="narrow">
      <section class="panel-card">
        <h2>Мой дневник</h2>
        <p class="note">Игры сохраняются в этом браузере на этом устройстве. Чтобы перенести их на другое устройство, скачай резервную копию и загрузи её там.</p>
        ${games.length ? `<div class="list">${games.map(g => `<div class="row"><div class="row-main"><b>${esc(g.request.text || 'Запрос не сформулирован')}</b><span>${esc(fmtDate(g.updatedAt))} · ${esc(statusText(g))}${g.element ? ' · ' + esc(D.ELEMENTS[g.element].name) : ''} · шагов: ${g.journal.filter(j => j.t === 'card').length}</span></div><div class="row-actions"><button class="btn small" data-act="open" data-id="${g.id}">${g.phase === 'finished' || g.phase === 'exited' ? 'Открыть' : 'Продолжить'}</button><button class="btn small ghost" data-act="sheet" data-id="${g.id}">Маршрут</button><button class="btn small ghost danger" data-act="delete" data-id="${g.id}">Удалить</button></div></div>`).join('')}</div>` : '<p>Пока нет ни одной игры.</p>'}
        <div class="actions"><button class="btn primary" data-act="new">Начать новую игру</button><button class="btn ghost" data-act="export">Скачать резервную копию</button><label class="btn ghost file">Загрузить копию<input type="file" id="import" accept="application/json,.json"></label></div>
      </section></main>`;
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
      case 'delete': { if (confirm('Удалить эту игру из дневника?')) { store.games = store.games.filter(x => x.id !== btn.dataset.id); if (store.activeId === btn.dataset.id) store.activeId = null; save(); } break; }
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
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ui.rules) { ui.rules = false; render(); } });

  render();
})();
