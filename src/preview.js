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

  function $(id) { return document.getElementById(id); }

  function setStatus(text) {
    const el = $('p-status');
    if (el) el.textContent = text;
  }

  // ----------------------------------------------------------------
  // Селектор состояний (ряд кликабельных меток)
  // ----------------------------------------------------------------
  function renderSelector() {
    const root = $('p-selector');
    root.innerHTML = '';
    if (!snap || !snap.states || snap.states.length === 0) return;

    snap.states.forEach((s, idx) => {
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
      root.appendChild(btn);
    });
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
      grid.style.display = 'none';
      setStatus('Файл не открыт');
      return;
    }

    if (selectedIdx >= snap.states.length) selectedIdx = 0;

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
    renderPreview();
  }

  W.initPreview = function () {
    W.fileBus.subscribe(onSnapshot);
    onSnapshot(W.fileBus.get());
  };

  // Активация вкладки → принудительный re-render: пока превью было
  // скрыто, в горизонтали могли менять имена/биты (по ссылке).
  W.previewOnTabActivate = function () {
    renderPreview();
  };
})();
