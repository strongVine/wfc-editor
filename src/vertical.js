// ============================================================
// vertical.js — вертикальный режим (две матрицы, Up/Down)
// ============================================================
//
// Геометрия:
//   upper.M[A].rows[5]  — Down верхней плитки (что под ней)
//   lower.M[B].rows[4]  — Up   нижней плитки (что над ней)
//
//   Симметрия: бит upper[A].M[5][B] @ r  ↔  бит lower[B].M[4][A] @ (4-r)%4

(function () {
  const W = window.WFC;

  function makeLayer(role) {
    return {
      role,
      states: [],
      collapsed: [],
      currentPath: null,
      completenessMask: null,
      dirty: false,
      editedDir: role === 'upper' ? W.D_DOWN : W.D_UP,
    };
  }

  const upper = makeLayer('upper');
  const lower = makeLayer('lower');
  function peer(layer) { return layer === upper ? lower : upper; }

  let validation = null;

  function $(id) { return document.getElementById(id); }

  // Структурный snapshot для потребителей (вкладка «Верт. визуал»).
  // Биты внутри states видны по ссылке — отдельный re-publish после правки бита
  // не нужен; вызывается только при open / save-as path / add / remove.
  function publishSnapshot() {
    W.verticalBus.publish({
      upper: { path: upper.currentPath, states: upper.states, mask: upper.completenessMask },
      lower: { path: lower.currentPath, states: lower.states, mask: lower.completenessMask },
    });
  }

  // ============================================================
  // Симметрия
  // ============================================================
  function toggleBit(layer, A, B, r) {
    const d = layer.editedDir;
    const cur = W.bitVal(layer.states[A].M[d][B], r);
    const next = cur ? 0 : 1;
    layer.states[A].M[d][B] = W.setBit(layer.states[A].M[d][B], r, next);

    const peerLayer = peer(layer);
    if (peerLayer.states.length > 0) {
      const m = W.mirror(A, d, B, r);
      if (m.A < peerLayer.states.length && m.B < peerLayer.states.length) {
        peerLayer.states[m.A].M[m.d][m.B] = W.setBit(peerLayer.states[m.A].M[m.d][m.B], m.r, next);
        return { peerActed: true, m };
      }
    }
    return { peerActed: false };
  }

  function validateSymmetry() {
    if (upper.states.length === 0 || lower.states.length === 0) return null;
    const NU = upper.states.length;
    const NL = lower.states.length;
    const bad = { upper: W.makeEmptyValidationMap(NU), lower: W.makeEmptyValidationMap(NL) };
    const miss = { upper: W.makeEmptyValidationMap(NU), lower: W.makeEmptyValidationMap(NL) };
    let errorCount = 0;

    for (let A = 0; A < NU; A++) {
      for (let B = 0; B < NL; B++) {
        for (let r = 0; r < W.BITS; r++) {
          const upBit = W.bitVal(upper.states[A].M[W.D_DOWN][B], r);
          const r0 = (4 - r) % 4;
          const downBit = W.bitVal(lower.states[B].M[W.D_UP][A], r0);
          if (upBit && !downBit) {
            bad.upper[A][W.D_DOWN][B][r] = 1;
            miss.lower[B][W.D_UP][A][r0] = 1;
            errorCount++;
          } else if (!upBit && downBit) {
            bad.lower[B][W.D_UP][A][r0] = 1;
            miss.upper[A][W.D_DOWN][B][r] = 1;
            errorCount++;
          }
        }
      }
    }
    return { bad, miss, errorCount };
  }

  function clearValidation() {
    validation = null;
    updateStatus();
  }

  // ============================================================
  // Status
  // ============================================================
  function setStatus(text, cls) {
    const el = $('v-status');
    el.textContent = text;
    el.className = 'status' + (cls ? ' ' + cls : '');
  }

  function fileLabel(layer, prefix) {
    if (!layer.currentPath) return prefix + ': —';
    const dot = layer.dirty ? '● ' : '';
    return prefix + ': ' + dot + W.fileName(layer.currentPath);
  }

  function updateStatus() {
    if (!upper.currentPath && !lower.currentPath) {
      setStatus('Файлы не открыты');
      return;
    }
    if (validation && validation.errorCount > 0) {
      setStatus(validation.errorCount + ' нарушений симметрии', 'bad');
      return;
    }
    const parts = [];
    if (upper.currentPath) parts.push(fileLabel(upper, 'верхний'));
    if (lower.currentPath) parts.push(fileLabel(lower, 'нижний'));
    const anyDirty = upper.dirty || lower.dirty;
    setStatus(parts.join('   '), anyDirty ? 'dirty' : 'ok');
  }

  function setDirty(layer, v) { layer.dirty = v; updateStatus(); }

  // ============================================================
  // Render
  // ============================================================
  function renderLayer(root, layer) {
    const peerLayer = peer(layer);
    const titleClass = layer.role === 'upper' ? 'upper' : 'lower';
    const titleText = layer.role === 'upper'
      ? 'Верхний слой — что под каждой плиткой (строка Down)'
      : 'Нижний слой — что над каждой плиткой (строка Up)';

    const title = document.createElement('div');
    title.className = 'matrix-title ' + titleClass;
    title.textContent = titleText;
    root.appendChild(title);

    if (layer.states.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'layer-empty';
      empty.textContent = 'Открой ' + (layer.role === 'upper' ? 'верхний' : 'нижний') +
        ' файл из меню «' + (layer.role === 'upper' ? 'Верхняя' : 'Нижняя') + ' ▾».';
      root.appendChild(empty);
      return;
    }

    const d = layer.editedDir;
    const peerN = peerLayer.states.length;
    const validBad = validation ? validation.bad[layer.role] : null;
    const validMiss = validation ? validation.miss[layer.role] : null;

    for (let a = 0; a < layer.states.length; a++) {
      const isCollapsed = layer.collapsed[a];

      const header = document.createElement('div');
      header.className = 'stateheader' + (isCollapsed ? ' collapsed' : '');

      const chev = document.createElement('span');
      chev.className = 'chevron';
      chev.textContent = '▼';
      chev.addEventListener('click', () => {
        layer.collapsed[a] = !layer.collapsed[a];
        renderMatrix();
      });
      header.appendChild(chev);

      const stateIdx = a;
      const labelEl = W.makeStateLabel({
        jsonPath: layer.currentPath,
        name: layer.states[a].name,
        editable: true,
        onChange: (newName) => {
          layer.states[stateIdx].name = newName;
          setDirty(layer, true);
        },
      });
      header.appendChild(labelEl);

      const summary = document.createElement('span');
      summary.className = 'state-summary';
      const live = peerN > 0 ? W.countLiveBitsInRow(layer.states[a], d, peerN) : 0;
      summary.textContent = W.pluralBits(live);
      header.appendChild(summary);

      root.appendChild(header);

      const body = document.createElement('div');
      body.className = 'state-body' + (isCollapsed ? ' collapsed' : '');

      if (peerN === 0) {
        const hint = document.createElement('div');
        hint.className = 'layer-empty';
        hint.textContent = 'Парный слой не открыт — нет колонок соседей.';
        body.appendChild(hint);
      } else {
        const wrap = document.createElement('div');
        wrap.className = 'scroll-wrap';
        const tbl = document.createElement('table');
        tbl.className = 'mtx';

        const thead = document.createElement('thead');
        const thr = document.createElement('tr');
        const corner = document.createElement('th');
        corner.textContent = '';
        thr.appendChild(corner);
        for (let b = 0; b < peerN; b++) {
          const th = document.createElement('th');
          // Шапка колонок — readonly. Иконки берём ИЗ ПАРНОГО слоя
          // (потому что это его состояния).
          th.appendChild(W.makeStateLabel({
            jsonPath: peerLayer.currentPath,
            name: peerLayer.states[b].name,
            editable: false,
          }));
          thr.appendChild(th);
        }
        thead.appendChild(thr);
        tbl.appendChild(thead);

        const tbody = document.createElement('tbody');
        const tr = document.createElement('tr');
        const labelTd = document.createElement('td');
        labelTd.className = 'dir-label';
        labelTd.textContent = d === W.D_UP ? 'Up' : 'Down';
        tr.appendChild(labelTd);

        for (let b = 0; b < peerN; b++) {
          const td = W.renderNibble(
            layer.states[a], a, d, b,
            (aa, dd, bb, rr) => onBitClick(layer, aa, bb, rr),
            validBad, validMiss
          );
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
        tbl.appendChild(tbody);
        wrap.appendChild(tbl);
        body.appendChild(wrap);
      }

      root.appendChild(body);
    }
  }

  function renderMatrix() {
    const root = $('v-matrix-container');
    root.innerHTML = '';
    if (upper.states.length === 0 && lower.states.length === 0) {
      root.innerHTML = '<div class="empty-hint">Открой верхний и нижний файлы матриц.</div>';
      return;
    }
    renderLayer(root, upper);
    renderLayer(root, lower);
  }

  function onBitClick(layer, A, B, r) {
    const res = toggleBit(layer, A, B, r);
    if (validation) clearValidation();
    setDirty(layer, true);
    if (res.peerActed) setDirty(peer(layer), true);
    renderMatrix();
    if (res.peerActed) {
      W.flashMirrorBit('#v-matrix-container', res.m.A, res.m.d, res.m.B, res.m.r);
    }
  }

  // ============================================================
  // File ops
  // ============================================================
  async function openFile(layer) {
    try {
      const selected = await W.tauri.open({
        multiple: false,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      });
      if (!selected) return;
      const path = typeof selected === 'string' ? selected : selected.path;
      const text = await W.tauri.readTextFile(path);
      const parsed = W.parseProjectJson(text);
      if (layer.currentPath) W.releaseIconCache(layer.currentPath);
      await W.scanIconFolder(path);
      layer.states = parsed.states;
      layer.completenessMask = parsed.completenessMask;
      layer.collapsed = new Array(layer.states.length).fill(false);
      layer.currentPath = path;
      layer.dirty = false;
      validation = validateSymmetry();
      updateStatus();
      updateButtonsState();
      renderMatrix();
      publishSnapshot();
    } catch (err) {
      console.error(err);
      setStatus('Ошибка: ' + err.message, 'bad');
    }
  }

  async function saveFile(layer) {
    if (!layer.currentPath) return saveFileAs(layer);
    try {
      await W.tauri.writeTextFile(layer.currentPath, W.serializeProjectJson(layer.states, layer.completenessMask));
      setDirty(layer, false);
    } catch (err) {
      console.error(err);
      setStatus('Ошибка сохранения: ' + err.message, 'bad');
    }
  }

  async function saveFileAs(layer) {
    try {
      const path = await W.tauri.save({
        filters: [{ name: 'JSON', extensions: ['json'] }],
        defaultPath: layer.currentPath || (layer.role + '.json')
      });
      if (!path) return;
      const mask = layer.completenessMask || W.makeEmptyCompletenessMask();
      await W.tauri.writeTextFile(path, W.serializeProjectJson(layer.states, mask));
      const pathChanged = path !== layer.currentPath;
      if (pathChanged) {
        if (layer.currentPath) W.releaseIconCache(layer.currentPath);
        await W.scanIconFolder(path);
      }
      layer.currentPath = path;
      layer.completenessMask = mask;
      setDirty(layer, false);
      renderMatrix();
      if (pathChanged) publishSnapshot();
    } catch (err) {
      console.error(err);
      setStatus('Ошибка сохранения: ' + err.message, 'bad');
    }
  }

  async function saveAllDirty() {
    if (upper.currentPath && upper.dirty) await saveFile(upper);
    if (lower.currentPath && lower.dirty) await saveFile(lower);
  }

  // ============================================================
  // Add / remove
  // ============================================================
  function addState(layer) {
    if (layer.states.length >= W.MAX_STATES) return;
    layer.states.push({ name: 'c' + layer.states.length, M: W.makeEmptyM() });
    layer.collapsed.push(false);
    if (validation) clearValidation();
    setDirty(layer, true);
    updateButtonsState();
    renderMatrix();
    publishSnapshot();
  }

  function removeLastState(layer) {
    if (layer.states.length <= 1) return;
    layer.states.pop();
    layer.collapsed.pop();
    if (validation) clearValidation();
    setDirty(layer, true);
    updateButtonsState();
    renderMatrix();
    publishSnapshot();
  }

  function updateButtonsState() {
    for (const role of ['upper', 'lower']) {
      const layer = role === 'upper' ? upper : lower;
      const menuId = role === 'upper' ? 'v-upper-menu' : 'v-lower-menu';
      const menu = $(menuId);
      const hasFile = !!layer.currentPath;
      const cnt = layer.states.length;
      menu.querySelector('[data-action="save"]').disabled = !hasFile;
      menu.querySelector('[data-action="save-as"]').disabled = !hasFile;
      menu.querySelector('[data-action="add-state"]').disabled = !hasFile || cnt >= W.MAX_STATES;
      menu.querySelector('[data-action="remove-state"]').disabled = !hasFile || cnt <= 1;
    }
    const anyOpen = !!(upper.currentPath || lower.currentPath);
    $('v-collapse-all').disabled = !anyOpen;
    $('v-expand-all').disabled = !anyOpen;
  }

  // ============================================================
  // Меню
  // ============================================================
  function wireMenu(btnId, menuId, layer) {
    const btn = $(btnId);
    const menu = $(menuId);

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.dropdown-menu.open').forEach(m => {
        if (m !== menu) m.classList.remove('open');
      });
      menu.classList.toggle('open');
    });

    menu.addEventListener('click', (e) => {
      const target = e.target;
      if (target.tagName !== 'BUTTON') return;
      const action = target.dataset.action;
      menu.classList.remove('open');
      switch (action) {
        case 'open': openFile(layer); break;
        case 'save': saveFile(layer); break;
        case 'save-as': saveFileAs(layer); break;
        case 'add-state': addState(layer); break;
        case 'remove-state': removeLastState(layer); break;
      }
    });
  }

  // ============================================================
  // Внешний API для других вкладок
  // ------------------------------------------------------------
  // Вкладка «Верт. визуал» редактирует те же два файла через эту точку.
  // Переиспользуется существующий путь правки бита: симметрия,
  // dirty-флаг, очистка валидации и re-render вертикальной таблицы
  // делаются ровно так же, как при клике в самом вертикальном режиме.
  // ============================================================
  W.verticalApi = {
    editBit(role, A, B, r) {
      const layer = role === 'upper' ? upper : (role === 'lower' ? lower : null);
      if (!layer) return false;
      if (layer.states.length === 0) return false;
      const peerLayer = peer(layer);
      if (peerLayer.states.length === 0) return false;
      if (A < 0 || A >= layer.states.length) return false;
      if (B < 0 || B >= peerLayer.states.length) return false;
      if (r < 0 || r >= W.BITS) return false;
      onBitClick(layer, A, B, r);
      return true;
    },
  };

  // ============================================================
  // Init
  // ============================================================
  W.initVertical = function () {
    wireMenu('v-upper-btn', 'v-upper-menu', upper);
    wireMenu('v-lower-btn', 'v-lower-menu', lower);

    document.addEventListener('click', () => {
      document.querySelectorAll('.dropdown-menu.open').forEach(m => m.classList.remove('open'));
    });

    $('v-collapse-all').addEventListener('click', () => {
      for (const layer of [upper, lower]) {
        for (let i = 0; i < layer.states.length; i++) layer.collapsed[i] = true;
      }
      renderMatrix();
    });

    $('v-expand-all').addEventListener('click', () => {
      for (const layer of [upper, lower]) {
        for (let i = 0; i < layer.states.length; i++) layer.collapsed[i] = false;
      }
      renderMatrix();
    });

    // Ctrl+S работает и в вертикали, и в её визуале — визуал редактирует
    // те же два файла, что и вертикаль, поэтому отдельный хоткей не нужен.
    document.addEventListener('keydown', (e) => {
      const mode = W.getCurrentMode();
      if (mode !== 'vertical' && mode !== 'vertical-visual') return;
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveAllDirty();
      }
    });
  };
})();
