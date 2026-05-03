// ============================================================
// vertical_preview.js — режим «Превью верт.».
// Визуализация и редактирование оси Up↔Down между двумя слоями.
// Пользователь выбирает слой-центр (upper / lower) и состояние A в нём;
// на физически правильной стороне (под центром если он сверху, над —
// если снизу) рисуется ряд парных плиток B в 4 поворотах. Клик по
// любому повороту переключает свой бит в матрице центрального слоя
// через W.verticalApi.editBit; зеркальный бит в парном слое §7
// проставляется автоматически — это та же кнопка-в-нибл, просто
// визуализированная как стопка двух уровней.
//
// Файлы берутся из вкладки «Вертикаль» через WFC.verticalBus.
// ============================================================

(function () {
  const W = window.WFC;

  let snap = null;
  let centerRole = 'upper';   // 'upper' | 'lower'
  let selectedIdx = 0;

  // Сессионные фильтры видимости — отдельный набор на каждый слой как
  // парный (потому что при смене центра парный слой меняется). Сбрасываются
  // при открытии нового файла соответствующего слоя; по умолчанию все
  // галочки сняты — пользователь сам решает, что показать.
  let visLowerAsPeer = new Set(); // индексы lower, когда центр upper
  let visUpperAsPeer = new Set(); // индексы upper, когда центр lower
  let prevPathUpper = null, prevPathLower = null;
  let prevLenUpper = 0, prevLenLower = 0;

  function $(id) { return document.getElementById(id); }

  function setStatus(text) {
    const el = $('pv-status');
    if (el) el.textContent = text;
  }

  function bothOpen() {
    return !!(snap && snap.upper && snap.lower && snap.upper.path && snap.lower.path
      && snap.upper.states.length > 0 && snap.lower.states.length > 0);
  }

  function reconcileEnabled() {
    if (!snap) {
      visLowerAsPeer = new Set();
      visUpperAsPeer = new Set();
      prevPathUpper = prevPathLower = null;
      prevLenUpper = prevLenLower = 0;
      return;
    }
    // Смена пути слоя сбрасывает фильтр, который относится к НЕМУ как к парному.
    if (snap.upper.path !== prevPathUpper) {
      visUpperAsPeer = new Set();
      prevPathUpper = snap.upper.path;
    }
    if (snap.lower.path !== prevPathLower) {
      visLowerAsPeer = new Set();
      prevPathLower = snap.lower.path;
    }
    // Сжатие при удалении состояний.
    const u = snap.upper.states.length;
    const l = snap.lower.states.length;
    if (l < prevLenLower) {
      for (const i of [...visLowerAsPeer]) if (i >= l) visLowerAsPeer.delete(i);
    }
    if (u < prevLenUpper) {
      for (const i of [...visUpperAsPeer]) if (i >= u) visUpperAsPeer.delete(i);
    }
    prevLenUpper = u;
    prevLenLower = l;
  }

  function getCenterPeer() {
    const isUp = centerRole === 'upper';
    return {
      isCenterUpper: isUp,
      centerLayer: isUp ? snap.upper : snap.lower,
      peerLayer: isUp ? snap.lower : snap.upper,
      d: isUp ? W.D_DOWN : W.D_UP,
      visSet: isUp ? visLowerAsPeer : visUpperAsPeer,
    };
  }

  // ----------------------------------------------------------------
  // Селектор: 1) тоггл центра ↑/↓, 2) ряд состояний центрального слоя
  // (выбор A), 3) ряд видимости парного слоя.
  // ----------------------------------------------------------------
  function renderSelector() {
    const root = $('pv-selector');
    root.innerHTML = '';
    if (!bothOpen()) return;

    const ctx = getCenterPeer();

    const togRow = document.createElement('div');
    togRow.className = 'preview-radio';
    const togLbl = document.createElement('span');
    togLbl.className = 'preview-visibility-label';
    togLbl.textContent = 'Центр:';
    togRow.appendChild(togLbl);
    [['upper', '↑ верх'], ['lower', '↓ низ']].forEach(([role, text]) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'preview-pick pv-role-' + role + (centerRole === role ? ' selected' : '');
      btn.textContent = text;
      btn.addEventListener('click', () => {
        if (centerRole !== role) {
          centerRole = role;
          selectedIdx = 0;
          renderPreview();
        }
      });
      togRow.appendChild(btn);
    });
    root.appendChild(togRow);

    const radioRow = document.createElement('div');
    radioRow.className = 'preview-radio';
    ctx.centerLayer.states.forEach((s, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'preview-pick' + (idx === selectedIdx ? ' selected' : '');
      btn.title = s.name;
      btn.appendChild(W.makeStateGlyph({
        jsonPath: ctx.centerLayer.path,
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

    const visRow = document.createElement('div');
    visRow.className = 'preview-visibility';
    const visLbl = document.createElement('span');
    visLbl.className = 'preview-visibility-label';
    visLbl.textContent = ctx.isCenterUpper ? 'Парный (низ):' : 'Парный (верх):';
    visRow.appendChild(visLbl);
    ctx.peerLayer.states.forEach((s, idx) => {
      const on = ctx.visSet.has(idx);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'preview-check' + (on ? '' : ' off');
      btn.title = s.name + (on ? ' — показывать' : ' — скрыть');
      btn.appendChild(W.makeStateGlyph({
        jsonPath: ctx.peerLayer.path,
        name: s.name,
        sizeClass: 'sz-md',
      }));
      btn.addEventListener('click', () => {
        if (ctx.visSet.has(idx)) ctx.visSet.delete(idx);
        else ctx.visSet.add(idx);
        renderPreview();
      });
      visRow.appendChild(btn);
    });
    root.appendChild(visRow);
  }

  // ----------------------------------------------------------------
  // Одна ячейка парной плитки: стек из 4 копий состояния B по поворотам.
  // Чтение бита — из ЦЕНТРАЛЬНОГО слоя: states[A].M[d][B] @ r,
  // где d = Down (центр upper) или Up (центр lower).
  // ----------------------------------------------------------------
  function renderCell(A, B) {
    const ctx = getCenterPeer();
    const cell = document.createElement('div');
    cell.className = 'preview-cell';

    const Bstate = ctx.peerLayer.states[B];
    const nibble = ctx.centerLayer.states[A].M[ctx.d][B];

    const stack = document.createElement('div');
    stack.className = 'preview-glyph-stack';

    let active = 0;
    for (let r = 0; r < W.BITS; r++) {
      const on = W.bitVal(nibble, r);
      if (on) active++;
      const glyph = W.makeStateGlyph({
        jsonPath: ctx.peerLayer.path,
        name: Bstate.name,
        rotation: r,
        dim: !on,
        sizeClass: 'sz-sm',
        extraClass: 'preview-edit',
      });
      glyph.dataset.a = A;
      glyph.dataset.b = B;
      glyph.dataset.r = r;
      glyph.title = Bstate.name + ' · ' + (r * 90) + '° · ' + (on ? 'выключить' : 'включить');
      glyph.addEventListener('click', (ev) => {
        ev.stopPropagation();
        onGlyphClick(A, B, r);
      });
      stack.appendChild(glyph);
    }

    if (active === 0) cell.classList.add('dim');
    cell.appendChild(stack);
    return cell;
  }

  function onGlyphClick(A, B, r) {
    if (!W.verticalApi || typeof W.verticalApi.editBit !== 'function') return;
    const ok = W.verticalApi.editBit(centerRole, A, B, r);
    if (ok) renderPreview();
  }

  function renderSide(A) {
    const ctx = getCenterPeer();
    const panel = document.createElement('div');
    panel.className = 'preview-side preview-vside ' + (ctx.isCenterUpper ? 'down' : 'up');

    const lbl = document.createElement('div');
    lbl.className = 'preview-side-label';
    lbl.textContent = ctx.isCenterUpper ? 'Down — что под' : 'Up — что над';
    panel.appendChild(lbl);

    const cells = document.createElement('div');
    cells.className = 'preview-side-cells';
    let any = false;
    for (let B = 0; B < ctx.peerLayer.states.length; B++) {
      if (!ctx.visSet.has(B)) continue;
      cells.appendChild(renderCell(A, B));
      any = true;
    }
    if (!any) {
      const hint = document.createElement('div');
      hint.className = 'preview-side-hint';
      hint.textContent = 'Включи галочки парного слоя выше.';
      cells.appendChild(hint);
    }
    panel.appendChild(cells);
    return panel;
  }

  function renderCenter(A) {
    const ctx = getCenterPeer();
    const center = document.createElement('div');
    center.className = 'preview-center pv-role-' + centerRole;
    center.appendChild(W.makeStateGlyph({
      jsonPath: ctx.centerLayer.path,
      name: ctx.centerLayer.states[A].name,
      sizeClass: 'sz-lg',
    }));
    const nm = document.createElement('div');
    nm.className = 'preview-center-name';
    nm.textContent = ctx.centerLayer.states[A].name;
    center.appendChild(nm);
    return center;
  }

  function renderPreview() {
    renderSelector();

    const stack = $('pv-stack');
    const empty = $('pv-empty');
    stack.innerHTML = '';

    if (!snap || !snap.upper || !snap.lower || !snap.upper.path || !snap.lower.path) {
      empty.style.display = '';
      empty.textContent = 'Открой оба файла во вкладке «Вертикаль».';
      stack.style.display = 'none';
      setStatus('Файлы не открыты');
      return;
    }
    if (snap.upper.states.length === 0 || snap.lower.states.length === 0) {
      empty.style.display = '';
      empty.textContent = 'Один из слоёв пуст — добавь хотя бы по одному состоянию.';
      stack.style.display = 'none';
      setStatus('—');
      return;
    }

    empty.style.display = 'none';
    stack.style.display = '';

    const ctx = getCenterPeer();
    const A = selectedIdx;

    // Физически правильная сторона: центр сверху → парные ниже; центр снизу → парные выше.
    if (ctx.isCenterUpper) {
      stack.appendChild(renderCenter(A));
      stack.appendChild(renderSide(A));
    } else {
      stack.appendChild(renderSide(A));
      stack.appendChild(renderCenter(A));
    }

    const upName = snap.upper.path ? W.fileName(snap.upper.path) : '—';
    const loName = snap.lower.path ? W.fileName(snap.lower.path) : '—';
    setStatus('↑ ' + upName + '   ↓ ' + loName +
      '   · центр ' + (ctx.isCenterUpper ? '↑' : '↓') + ': ' + ctx.centerLayer.states[A].name);
  }

  function onSnapshot(s) {
    snap = s;
    if (snap && snap.upper && snap.lower) {
      const ctx = getCenterPeer();
      if (selectedIdx >= ctx.centerLayer.states.length) selectedIdx = 0;
    } else {
      selectedIdx = 0;
    }
    reconcileEnabled();
    renderPreview();
  }

  W.initVerticalPreview = function () {
    W.verticalBus.subscribe(onSnapshot);
    onSnapshot(W.verticalBus.get());
  };

  // Активация вкладки → принудительный re-render: пока превью верт. было
  // скрыто, в самой вертикали могли менять имена/биты (по ссылке).
  W.verticalPreviewOnTabActivate = function () {
    reconcileEnabled();
    renderPreview();
  };
})();
