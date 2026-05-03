// ============================================================
// horizontal_visual.js — режим «Гор. визуал».
// Визуальная форма горизонтального редактора. Пользователь выбирает
// состояние A, программа рисует крест из 4 горизонтальных сторон. Для
// каждой стороны d показываются все N состояний; для каждого B рисуются
// все 4 поворота r∈{0..3} — цветной если bitVal(M[A][d][B], r)===1,
// иначе приглушённый. Клик по любому из 4 глифов в боковой ячейке
// переключает соответствующий бит — редактирование делегируется
// в горизонтальный режим, который и хранит файл (см. WFC.horizontalApi).
// Симметрия §7 проставляется автоматически — это та же кнопка-в-нибл,
// просто визуализированная как сетка тайлов.
//
// Файл берётся из вкладки «Горизонталь» через WFC.fileBus.
// ============================================================

(function () {
  const W = window.WFC;

  const SIDES = [
    { d: W.D_FRONT, area: 'front', label: 'Front' },
    { d: W.D_RIGHT, area: 'right', label: 'Right' },
    { d: W.D_BACK,  area: 'back',  label: 'Back' },
    { d: W.D_LEFT,  area: 'left',  label: 'Left' },
  ];

  let snap = null;
  let selectedIdx = 0;

  // Сессионный фильтр видимости: индексы видимых состояний.
  // Сбрасывается при открытии нового файла; по умолчанию все
  // галочки сняты — пользователь сам решает, что показать. При
  // remove удалённые индексы вычищаются.
  let enabled = new Set();
  let prevPath = null;
  let prevLen = 0;

  function $(id) { return document.getElementById(id); }

  function setStatus(text) {
    const el = $('hv-status');
    if (el) el.textContent = text;
  }

  function reconcileEnabled() {
    if (!snap || !snap.states) {
      enabled = new Set();
      prevPath = null;
      prevLen = 0;
      return;
    }
    const n = snap.states.length;
    if (snap.path !== prevPath) {
      enabled = new Set();
    } else if (n < prevLen) {
      for (const i of [...enabled]) if (i >= n) enabled.delete(i);
    }
    prevPath = snap.path;
    prevLen = n;
  }

  // ----------------------------------------------------------------
  // Селектор состояний: два независимых ряда.
  //   Ряд 1 — выбор центрального A. Всегда все N плиток.
  //   Ряд 2 — фильтр для боковых сторон. По умолчанию все галочки
  //           сняты; включённые состояния рисуются в боковых
  //           ячейках, выключенные — не отображаются вовсе.
  //           Ряд 1 и центр не трогает.
  // ----------------------------------------------------------------
  function renderSelector() {
    const root = $('hv-selector');
    root.innerHTML = '';
    if (!snap || !snap.states || snap.states.length === 0) return;

    const radioRow = document.createElement('div');
    radioRow.className = 'vis-radio';
    snap.states.forEach((s, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'vis-pick' + (idx === selectedIdx ? ' selected' : '');
      btn.title = s.name;
      btn.appendChild(W.makeStateGlyph({
        jsonPath: snap.path,
        name: s.name,
        sizeClass: 'sz-md',
      }));
      btn.addEventListener('click', () => {
        selectedIdx = idx;
        renderVisual();
      });
      radioRow.appendChild(btn);
    });
    root.appendChild(radioRow);

    const visRow = document.createElement('div');
    visRow.className = 'vis-visibility';
    const lbl = document.createElement('span');
    lbl.className = 'vis-visibility-label';
    lbl.textContent = 'На сторонах:';
    visRow.appendChild(lbl);
    snap.states.forEach((s, idx) => {
      const on = enabled.has(idx);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'vis-check' + (on ? '' : ' off');
      btn.title = s.name + (on ? ' — показывать на сторонах' : ' — скрыть со сторон');
      btn.appendChild(W.makeStateGlyph({
        jsonPath: snap.path,
        name: s.name,
        sizeClass: 'sz-md',
      }));
      btn.addEventListener('click', () => {
        if (enabled.has(idx)) enabled.delete(idx);
        else enabled.add(idx);
        renderVisual();
      });
      visRow.appendChild(btn);
    });
    root.appendChild(visRow);
  }

  // ----------------------------------------------------------------
  // Одна ячейка стороны: всегда 4 копии состояния B (по одной на
  // каждый поворот r∈{0..3}). Копия цветная, если bitVal(nibble,r)===1;
  // иначе — приглушённая (серая). Каждый глиф кликабелен — клик
  // переключает свой бит в states[A].M[d][B] @ r через
  // W.horizontalApi.editBit (там же ставится зеркальный бит §7,
  // выставляется dirty и перерендеривается горизонтальная таблица).
  // Состояния, не включённые в фильтр, в эту функцию не попадают —
  // они отсеиваются на уровне выше.
  // ----------------------------------------------------------------
  function renderCell(A, d, B) {
    const cell = document.createElement('div');
    cell.className = 'vis-cell';

    const Bstate = snap.states[B];
    const nibble = snap.states[A].M[d][B];

    const stack = document.createElement('div');
    stack.className = 'vis-glyph-stack';

    const activeRotations = [];
    for (let r = 0; r < W.BITS; r++) {
      const on = W.bitVal(nibble, r);
      if (on) activeRotations.push(r);
      const glyph = W.makeStateGlyph({
        jsonPath: snap.path,
        name: Bstate.name,
        rotation: r,
        dim: !on,
        sizeClass: 'sz-sm',
        extraClass: 'vis-edit',
      });
      glyph.dataset.a = A;
      glyph.dataset.d = d;
      glyph.dataset.b = B;
      glyph.dataset.r = r;
      glyph.title = Bstate.name + ' · ' + (r * 90) + '° · ' + (on ? 'выключить' : 'включить');
      glyph.addEventListener('click', (ev) => {
        ev.stopPropagation();
        onGlyphClick(A, d, B, r);
      });
      stack.appendChild(glyph);
    }

    if (activeRotations.length === 0) {
      cell.classList.add('dim');
    }

    cell.appendChild(stack);
    return cell;
  }

  function onGlyphClick(A, d, B, r) {
    if (!W.horizontalApi || typeof W.horizontalApi.editBit !== 'function') return;
    const ok = W.horizontalApi.editBit(A, d, B, r);
    if (ok) renderVisual();
  }

  function renderSidePanel(A, side) {
    const panel = document.createElement('div');
    panel.className = 'vis-side ' + side.area;
    panel.style.gridArea = side.area;

    const lbl = document.createElement('div');
    lbl.className = 'vis-side-label';
    lbl.textContent = side.label;
    panel.appendChild(lbl);

    const cells = document.createElement('div');
    cells.className = 'vis-side-cells';
    for (let B = 0; B < snap.states.length; B++) {
      if (!enabled.has(B)) continue;
      cells.appendChild(renderCell(A, side.d, B));
    }
    panel.appendChild(cells);
    return panel;
  }

  function renderCenter(A) {
    const center = document.createElement('div');
    center.className = 'vis-center';
    center.style.gridArea = 'center';
    center.appendChild(W.makeStateGlyph({
      jsonPath: snap.path,
      name: snap.states[A].name,
      sizeClass: 'sz-lg',
    }));
    const nm = document.createElement('div');
    nm.className = 'vis-center-name';
    nm.textContent = snap.states[A].name;
    center.appendChild(nm);
    return center;
  }

  function renderVisual() {
    renderSelector();

    const grid = $('hv-grid');
    const empty = $('hv-empty');
    grid.innerHTML = '';

    if (!snap || !snap.states || snap.states.length === 0) {
      empty.style.display = '';
      empty.textContent = 'Открой файл во вкладке «Горизонталь».';
      grid.style.display = 'none';
      setStatus('Файл не открыт');
      return;
    }

    empty.style.display = 'none';
    grid.style.display = '';

    const A = selectedIdx;
    grid.appendChild(renderCenter(A));
    SIDES.forEach(side => grid.appendChild(renderSidePanel(A, side)));

    const fname = snap.path ? W.fileName(snap.path) : '(без имени)';
    setStatus(fname + ' · выбрано: ' + snap.states[A].name);
  }

  // ----------------------------------------------------------------
  // Подписка на структурные изменения файла. Имя/биты внутри states
  // видны по ссылке — отдельно ребриджить их не нужно.
  // ----------------------------------------------------------------
  function onSnapshot(s) {
    snap = s;
    if (!s || !s.states) selectedIdx = 0;
    else if (selectedIdx >= s.states.length) selectedIdx = 0;
    reconcileEnabled();
    renderVisual();
  }

  W.initHorizontalVisual = function () {
    W.fileBus.subscribe(onSnapshot);
    onSnapshot(W.fileBus.get());
  };

  // Активация вкладки → принудительный re-render: пока вкладка была
  // скрыта, в горизонтали могли менять имена/биты (по ссылке).
  W.horizontalVisualOnTabActivate = function () {
    reconcileEnabled();
    renderVisual();
  };
})();
