// ============================================================
// preview.js — экспериментальный режим «Превью».
// Read-only визуализация: пользователь выбирает состояние A,
// программа рисует крест из 4 горизонтальных сторон. Для каждой
// стороны d показываются все N состояний; те B, у которых есть
// валидный поворот в states[A].M[d][B], рисуются с поворотом
// r·90° (все валидные r — в одной ячейке). Несоединяющиеся —
// приглушены.
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
  // Сбрасывается при открытии нового файла; при add/remove новые
  // индексы автоматически включаются, удалённые — вычищаются.
  let enabled = new Set();
  let prevPath = null;
  let prevLen = 0;

  function $(id) { return document.getElementById(id); }

  function setStatus(text) {
    const el = $('p-status');
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
      for (let i = 0; i < n; i++) enabled.add(i);
    } else {
      if (n < prevLen) {
        for (const i of [...enabled]) if (i >= n) enabled.delete(i);
      }
      if (n > prevLen) {
        for (let i = prevLen; i < n; i++) enabled.add(i);
      }
    }
    prevPath = snap.path;
    prevLen = n;

    if (enabled.size > 0 && !enabled.has(selectedIdx)) {
      selectedIdx = Math.min(...enabled);
    }
  }

  // ----------------------------------------------------------------
  // Селектор состояний: два ряда — выбор центрального A (radio)
  // и фильтр видимости (checkbox).
  // ----------------------------------------------------------------
  function renderSelector() {
    const root = $('p-selector');
    root.innerHTML = '';
    if (!snap || !snap.states || snap.states.length === 0) return;

    // Ряд 1: выбор центрального A. Скрываем выключенные — они полностью
    // исчезают из превью.
    const radioRow = document.createElement('div');
    radioRow.className = 'preview-radio';
    snap.states.forEach((s, idx) => {
      if (!enabled.has(idx)) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'preview-pick' + (idx === selectedIdx ? ' selected' : '');
      btn.title = s.name;
      btn.appendChild(W.makeStateGlyph({
        jsonPath: snap.path,
        name: s.name,
        sizeClass: 'sz-md',
      }));
      btn.addEventListener('click', () => {
        selectedIdx = idx;
        renderPreview();
      });
      radioRow.appendChild(btn);
    });
    root.appendChild(radioRow);

    // Ряд 2: чекбоксы видимости. Показываем ВСЕ состояния (иначе
    // выключенные нельзя вернуть). Off-плитки приглушены.
    const visRow = document.createElement('div');
    visRow.className = 'preview-visibility';
    const lbl = document.createElement('span');
    lbl.className = 'preview-visibility-label';
    lbl.textContent = 'Видимость:';
    visRow.appendChild(lbl);
    snap.states.forEach((s, idx) => {
      const on = enabled.has(idx);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'preview-check' + (on ? '' : ' off');
      btn.title = s.name + (on ? ' — показывать' : ' — скрыто');
      btn.appendChild(W.makeStateGlyph({
        jsonPath: snap.path,
        name: s.name,
        sizeClass: 'sz-md',
      }));
      btn.addEventListener('click', () => {
        if (enabled.has(idx)) enabled.delete(idx);
        else enabled.add(idx);
        // Если выключили текущий A — переключимся на первый видимый
        // (а если включили — selectedIdx остаётся валидным).
        if (enabled.size > 0 && !enabled.has(selectedIdx)) {
          selectedIdx = Math.min(...enabled);
        }
        renderPreview();
      });
      visRow.appendChild(btn);
    });
    root.appendChild(visRow);
  }

  // ----------------------------------------------------------------
  // Одна ячейка стороны: состояние B относительно выбранного A
  // в направлении d.
  //   nibble = 0           → одна dim-копия B
  //   иначе для каждого r,r∈валидных битов → копия B с rotate(r·90°)
  // ----------------------------------------------------------------
  function renderCell(A, d, B) {
    const cell = document.createElement('div');
    cell.className = 'preview-cell';

    const Bstate = snap.states[B];
    const nibble = snap.states[A].M[d][B];

    const stack = document.createElement('div');
    stack.className = 'preview-glyph-stack';

    if (nibble === 0) {
      cell.classList.add('dim');
      stack.appendChild(W.makeStateGlyph({
        jsonPath: snap.path,
        name: Bstate.name,
        dim: true,
        sizeClass: 'sz-sm',
      }));
      cell.title = Bstate.name + ' — нет соединения';
    } else {
      const rotations = [];
      for (let r = 0; r < W.BITS; r++) {
        if (W.bitVal(nibble, r)) rotations.push(r);
      }
      rotations.forEach(r => {
        stack.appendChild(W.makeStateGlyph({
          jsonPath: snap.path,
          name: Bstate.name,
          rotation: r,
          sizeClass: 'sz-sm',
        }));
      });
      cell.title = Bstate.name + ' — повороты: ' + rotations.map(r => (r * 90) + '°').join(', ');
    }

    cell.appendChild(stack);
    return cell;
  }

  function renderSidePanel(A, side) {
    const panel = document.createElement('div');
    panel.className = 'preview-side ' + side.area;
    panel.style.gridArea = side.area;

    const lbl = document.createElement('div');
    lbl.className = 'preview-side-label';
    lbl.textContent = side.label;
    panel.appendChild(lbl);

    const cells = document.createElement('div');
    cells.className = 'preview-side-cells';
    for (let B = 0; B < snap.states.length; B++) {
      if (!enabled.has(B)) continue;
      cells.appendChild(renderCell(A, side.d, B));
    }
    panel.appendChild(cells);
    return panel;
  }

  function renderCenter(A) {
    const center = document.createElement('div');
    center.className = 'preview-center';
    center.style.gridArea = 'center';
    center.appendChild(W.makeStateGlyph({
      jsonPath: snap.path,
      name: snap.states[A].name,
      sizeClass: 'sz-lg',
    }));
    const nm = document.createElement('div');
    nm.className = 'preview-center-name';
    nm.textContent = snap.states[A].name;
    center.appendChild(nm);
    return center;
  }

  function renderPreview() {
    renderSelector();

    const grid = $('p-grid');
    const empty = $('p-empty');
    grid.innerHTML = '';

    if (!snap || !snap.states || snap.states.length === 0) {
      empty.style.display = '';
      empty.textContent = 'Открой файл во вкладке «Горизонталь».';
      grid.style.display = 'none';
      setStatus('Файл не открыт');
      return;
    }

    if (enabled.size === 0) {
      empty.style.display = '';
      empty.textContent = 'Все состояния скрыты — включи хотя бы одно в ряду «Видимость».';
      grid.style.display = 'none';
      setStatus(W.fileName(snap.path) + ' · нет видимых состояний');
      return;
    }

    if (!enabled.has(selectedIdx)) selectedIdx = Math.min(...enabled);

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
    renderPreview();
  }

  W.initPreview = function () {
    W.fileBus.subscribe(onSnapshot);
    onSnapshot(W.fileBus.get());
  };

  // Активация вкладки → принудительный re-render: пока превью было
  // скрыто, в горизонтали могли менять имена/биты (по ссылке).
  W.previewOnTabActivate = function () {
    reconcileEnabled();
    renderPreview();
  };
})();
