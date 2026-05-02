// ============================================================
// horizontal.js — горизонтальный режим
// ============================================================

(function () {
  const W = window.WFC;

  const UI_DIRS = [0, 1, 2, 3];

  // Состояние режима
  let states = [];
  let collapsed = [];
  let currentPath = null;
  let currentMask = null;  // completenessMask из файла; редактор хранит её как непрозрачные данные
  let dirty = false;
  let validation = null;

  function $(id) { return document.getElementById(id); }

  // Уведомить read-only потребителей (вкладка «Превью») о структурных
  // изменениях. Имя/биты внутри states видны им по ссылке без re-publish.
  function publishSnapshot() {
    W.fileBus.publish({ path: currentPath, states, mask: currentMask });
  }

  // ============================================================
  // Симметрия / валидация
  // ============================================================
  function toggleBit(A, d, B, r) {
    const cur = W.bitVal(states[A].M[d][B], r);
    const next = cur ? 0 : 1;
    states[A].M[d][B] = W.setBit(states[A].M[d][B], r, next);
    const m = W.mirror(A, d, B, r);
    if (m.A < states.length && m.B < states.length) {
      states[m.A].M[m.d][m.B] = W.setBit(states[m.A].M[m.d][m.B], m.r, next);
    }
    return m;
  }

  function validateSymmetry() {
    const N = states.length;
    const bad = W.makeEmptyValidationMap(N);
    const miss = W.makeEmptyValidationMap(N);
    let errorCount = 0;
    for (let A = 0; A < N; A++) {
      for (let d = 0; d < 4; d++) {
        for (let B = 0; B < N; B++) {
          for (let r = 0; r < W.BITS; r++) {
            if (!W.bitVal(states[A].M[d][B], r)) continue;
            const m = W.mirror(A, d, B, r);
            if (m.A >= N || m.B >= N) continue;
            if (!W.bitVal(states[m.A].M[m.d][m.B], m.r)) {
              bad[A][d][B][r] = 1;
              miss[m.A][m.d][m.B][m.r] = 1;
              errorCount++;
            }
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
    const el = $('h-status');
    el.textContent = text;
    el.className = 'status' + (cls ? ' ' + cls : '');
  }

  function updateStatus() {
    if (!currentPath) { setStatus('Файл не открыт'); return; }
    if (validation && validation.errorCount > 0) {
      setStatus(validation.errorCount + ' нарушений симметрии', 'bad');
    } else if (dirty) {
      setStatus('● ' + W.fileName(currentPath), 'dirty');
    } else {
      setStatus(W.fileName(currentPath), 'ok');
    }
  }

  function setDirty(v) { dirty = v; updateStatus(); }

  // ============================================================
  // Render
  // ============================================================
  function renderMatrix() {
    const root = $('h-matrix-container');
    root.innerHTML = '';

    if (states.length === 0) {
      root.innerHTML = '<div class="empty-hint">Нажми «Открыть…» чтобы загрузить файл матрицы.</div>';
      return;
    }

    for (let a = 0; a < states.length; a++) {
      const isCollapsed = collapsed[a];

      const header = document.createElement('div');
      header.className = 'stateheader' + (isCollapsed ? ' collapsed' : '');

      const chev = document.createElement('span');
      chev.className = 'chevron';
      chev.textContent = '▼';
      chev.addEventListener('click', () => {
        collapsed[a] = !collapsed[a];
        renderMatrix();
      });
      header.appendChild(chev);

      // Иконка (если есть) + редактируемое имя — фабрика лежит в main.js
      const stateIdx = a;
      const labelEl = W.makeStateLabel({
        jsonPath: currentPath,
        name: states[a].name,
        editable: true,
        onChange: (newName) => {
          states[stateIdx].name = newName;
          setDirty(true);
        },
      });
      header.appendChild(labelEl);

      const summary = document.createElement('span');
      summary.className = 'state-summary';
      summary.textContent = W.pluralBits(W.countLiveBitsAllDirs(states[a], UI_DIRS, states.length));
      header.appendChild(summary);

      root.appendChild(header);

      const body = document.createElement('div');
      body.className = 'state-body' + (isCollapsed ? ' collapsed' : '');

      const wrap = document.createElement('div');
      wrap.className = 'scroll-wrap';
      const tbl = document.createElement('table');
      tbl.className = 'mtx';

      const thead = document.createElement('thead');
      const thr = document.createElement('tr');
      const corner = document.createElement('th');
      corner.textContent = '';
      thr.appendChild(corner);
      for (let b = 0; b < states.length; b++) {
        const th = document.createElement('th');
        // Шапка колонок — readonly. Иконка если есть, иначе текст.
        th.appendChild(W.makeStateLabel({
          jsonPath: currentPath,
          name: states[b].name,
          editable: false,
        }));
        thr.appendChild(th);
      }
      thead.appendChild(thr);
      tbl.appendChild(thead);

      const tbody = document.createElement('tbody');
      for (const d of UI_DIRS) {
        const tr = document.createElement('tr');
        const labelTd = document.createElement('td');
        labelTd.className = 'dir-label';
        labelTd.textContent = W.DIRS_LABELS[d];
        tr.appendChild(labelTd);

        for (let b = 0; b < states.length; b++) {
          const td = W.renderNibble(
            states[a], a, d, b,
            onBitClick,
            validation ? validation.bad : null,
            validation ? validation.miss : null
          );
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
      tbl.appendChild(tbody);
      wrap.appendChild(tbl);
      body.appendChild(wrap);
      root.appendChild(body);
    }
  }

  function onBitClick(a, d, b, r) {
    const m = toggleBit(a, d, b, r);
    if (validation) clearValidation();
    setDirty(true);
    renderMatrix();
    if (m.A < states.length && m.B < states.length && m.d < 4) {
      W.flashMirrorBit('#h-matrix-container', m.A, m.d, m.B, m.r);
    }
  }

  // ============================================================
  // File ops
  // ============================================================
  async function openFile() {
    try {
      const selected = await W.tauri.open({
        multiple: false,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      });
      if (!selected) return;
      const path = typeof selected === 'string' ? selected : selected.path;
      const text = await W.tauri.readTextFile(path);
      const parsed = W.parseProjectJson(text);
      if (currentPath) W.releaseIconCache(currentPath);
      await W.scanIconFolder(path);
      states = parsed.states;
      currentMask = parsed.completenessMask;
      collapsed = new Array(states.length).fill(false);
      currentPath = path;
      dirty = false;
      validation = validateSymmetry();
      updateStatus();
      enableButtons(true);
      renderMatrix();
      publishSnapshot();
    } catch (err) {
      console.error(err);
      setStatus('Ошибка: ' + err.message, 'bad');
    }
  }

  async function saveFile() {
    if (!currentPath) return saveFileAs();
    try {
      await W.tauri.writeTextFile(currentPath, W.serializeProjectJson(states, currentMask));
      setDirty(false);
    } catch (err) {
      console.error(err);
      setStatus('Ошибка сохранения: ' + err.message, 'bad');
    }
  }

  async function saveFileAs() {
    try {
      const path = await W.tauri.save({
        filters: [{ name: 'JSON', extensions: ['json'] }],
        defaultPath: currentPath || 'matrix.json'
      });
      if (!path) return;
      const mask = currentMask || W.makeEmptyCompletenessMask();
      await W.tauri.writeTextFile(path, W.serializeProjectJson(states, mask));
      if (path !== currentPath) {
        if (currentPath) W.releaseIconCache(currentPath);
        await W.scanIconFolder(path);
      }
      const pathChanged = path !== currentPath;
      currentPath = path;
      currentMask = mask;
      setDirty(false);
      renderMatrix();
      if (pathChanged) publishSnapshot();
    } catch (err) {
      console.error(err);
      setStatus('Ошибка сохранения: ' + err.message, 'bad');
    }
  }

  // ============================================================
  // Add / remove
  // ============================================================
  function addState() {
    if (states.length >= W.MAX_STATES) return;
    states.push({ name: 'c' + states.length, M: W.makeEmptyM() });
    collapsed.push(false);
    if (validation) clearValidation();
    setDirty(true);
    updateButtonsState();
    renderMatrix();
    publishSnapshot();
  }

  function removeLastState() {
    if (states.length <= 1) return;
    states.pop();
    collapsed.pop();
    if (validation) clearValidation();
    setDirty(true);
    updateButtonsState();
    renderMatrix();
    publishSnapshot();
  }

  function updateButtonsState() {
    $('h-add-state').disabled = states.length >= W.MAX_STATES;
    $('h-remove-state').disabled = states.length <= 1;
  }

  function enableButtons(on) {
    $('h-save').disabled = !on;
    $('h-save-as').disabled = !on;
    $('h-collapse-all').disabled = !on;
    $('h-expand-all').disabled = !on;
    if (on) updateButtonsState();
    else {
      $('h-add-state').disabled = true;
      $('h-remove-state').disabled = true;
    }
  }

  // ============================================================
  // Внешний API для других вкладок
  // ------------------------------------------------------------
  // Вкладка «Превью» редактирует тот же файл через эти точки. По сути
  // переиспользует уже существующий путь правки бита: симметрия,
  // dirty-флаг, очистка валидации и re-render горизонтальной таблицы
  // делаются ровно так же, как при клике в самой горизонтали.
  // ============================================================
  W.horizontalApi = {
    editBit(A, d, B, r) {
      if (states.length === 0) return false;
      if (A < 0 || A >= states.length) return false;
      if (B < 0 || B >= states.length) return false;
      if (d < 0 || d > 3) return false;
      if (r < 0 || r >= W.BITS) return false;
      onBitClick(A, d, B, r);
      return true;
    },
  };

  // ============================================================
  // Init
  // ============================================================
  W.initHorizontal = function () {
    $('h-open').addEventListener('click', openFile);
    $('h-save').addEventListener('click', saveFile);
    $('h-save-as').addEventListener('click', saveFileAs);
    $('h-add-state').addEventListener('click', addState);
    $('h-remove-state').addEventListener('click', removeLastState);
    $('h-collapse-all').addEventListener('click', () => {
      for (let i = 0; i < states.length; i++) collapsed[i] = true;
      renderMatrix();
    });
    $('h-expand-all').addEventListener('click', () => {
      for (let i = 0; i < states.length; i++) collapsed[i] = false;
      renderMatrix();
    });

    // Ctrl+S работает и в горизонтали, и в превью — превью редактирует
    // тот же файл, что и горизонталь, поэтому отдельный хоткей не нужен.
    document.addEventListener('keydown', (e) => {
      const mode = W.getCurrentMode();
      if (mode !== 'horizontal' && mode !== 'preview') return;
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (currentPath) saveFile();
        else if (states.length > 0) saveFileAs();
      }
    });
  };
})();
