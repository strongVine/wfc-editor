// ============================================================
// main.js — общий код: парсинг, симметрия, UI-примитивы, табы
// ============================================================

(function () {
  const WFC = {};
  window.WFC = WFC;

  const { open, save } = window.__TAURI__.dialog;
  const { readTextFile, writeTextFile } = window.__TAURI__.fs;

  // ============================================================
  // Константы
  // ============================================================
  WFC.DIR_COUNT = 6;
  WFC.NIBBLES_PER_ROW = 16;
  WFC.BITS = 4;
  WFC.MAX_STATES = 16;
  WFC.DIRS_LABELS = ['Front', 'Right', 'Back', 'Left', 'Up', 'Down'];

  WFC.D_FRONT = 0;
  WFC.D_RIGHT = 1;
  WFC.D_BACK = 2;
  WFC.D_LEFT = 3;
  WFC.D_UP = 4;
  WFC.D_DOWN = 5;

  // ============================================================
  // Tauri API
  // ============================================================
  WFC.tauri = { open, save, readTextFile, writeTextFile };

  // ============================================================
  // Битовые операции
  // ============================================================
  WFC.bitVal = function (nibble, r) { return (nibble >> r) & 1; };

  WFC.setBit = function (nibble, r, v) {
    return v ? (nibble | (1 << r)) : (nibble & ~(1 << r));
  };

  // ============================================================
  // Симметрия §7
  // ============================================================
  WFC.mirror = function (A, d, B, r) {
    if (d < 4) {
      const dp = (((d + 2) % 4) - r + 4) % 4;
      const r0 = (4 - r) % 4;
      return { A: B, d: dp, B: A, r: r0 };
    } else {
      const dp = d === WFC.D_UP ? WFC.D_DOWN : WFC.D_UP;
      const r0 = (4 - r) % 4;
      return { A: B, d: dp, B: A, r: r0 };
    }
  };

  // ============================================================
  // Парсинг / сериализация формата проекта
  // ============================================================
  WFC.parseProjectJson = function (text) {
    const data = JSON.parse(text);
    if (!Array.isArray(data)) throw new Error('Корневой JSON должен быть массивом');
    if (data.length < 1 || data.length > WFC.MAX_STATES) {
      throw new Error('Состояний должно быть 1..' + WFC.MAX_STATES + ', получено ' + data.length);
    }

    return data.map((entry, idx) => {
      if (typeof entry.name !== 'string') throw new Error('Состояние ' + idx + ': отсутствует name');
      if (!Array.isArray(entry.rows) || entry.rows.length !== WFC.DIR_COUNT) {
        throw new Error('Состояние ' + idx + ': rows должен быть массивом из ' + WFC.DIR_COUNT + ' строк');
      }
      const M = entry.rows.map((row, d) => {
        if (typeof row !== 'string' || row.length !== WFC.NIBBLES_PER_ROW) {
          throw new Error('Состояние ' + idx + ', направление ' + d + ': строка должна быть ' + WFC.NIBBLES_PER_ROW + ' hex-символов');
        }
        return Array.from(row).map(ch => {
          const v = parseInt(ch, 16);
          if (Number.isNaN(v)) throw new Error('Состояние ' + idx + ', направление ' + d + ': невалидный hex "' + ch + '"');
          return v;
        });
      });
      return { name: entry.name, M };
    });
  };

  WFC.serializeProjectJson = function (states) {
    const data = states.map(s => ({
      name: s.name,
      rows: s.M.map(row =>
        row.map(n => n.toString(16).toUpperCase()).join('')
      )
    }));
    return JSON.stringify(data, null, 2);
  };

  WFC.makeEmptyM = function () {
    const M = [];
    for (let d = 0; d < WFC.DIR_COUNT; d++) {
      M.push(new Array(WFC.NIBBLES_PER_ROW).fill(0));
    }
    return M;
  };

  // ============================================================
  // Подсчёт живых битов
  // ============================================================
  WFC.countLiveBitsInRow = function (state, d, numCols) {
    let n = 0;
    for (let b = 0; b < numCols; b++) {
      let nb = state.M[d][b];
      while (nb) { n += nb & 1; nb >>= 1; }
    }
    return n;
  };

  WFC.countLiveBitsAllDirs = function (state, dirs, numCols) {
    let n = 0;
    for (const d of dirs) n += WFC.countLiveBitsInRow(state, d, numCols);
    return n;
  };

  WFC.pluralBits = function (n) {
    if (n === 0) return 'пусто';
    if (n === 1) return '1 бит';
    if (n < 5) return n + ' бита';
    return n + ' бит';
  };

  // ============================================================
  // UI-примитивы
  // ============================================================
  WFC.renderNibble = function (state, a, d, b, onClick, badMap, missMap) {
    const td = document.createElement('td');
    const nb = document.createElement('div');
    nb.className = 'nibble';
    for (let r = WFC.BITS - 1; r >= 0; r--) {
      const bit = document.createElement('div');
      const isOn = !!WFC.bitVal(state.M[d][b], r);
      let cls = 'bit';
      if (isOn) cls += ' on';
      if (badMap && isOn && badMap[a][d][b][r]) cls += ' bad';
      if (missMap && !isOn && missMap[a][d][b][r]) cls += ' missing';
      bit.className = cls;
      bit.dataset.a = a;
      bit.dataset.d = d;
      bit.dataset.b = b;
      bit.dataset.r = r;
      bit.addEventListener('click', () => onClick(a, d, b, r));
      nb.appendChild(bit);
    }
    td.appendChild(nb);
    return td;
  };

  WFC.flashMirrorBit = function (containerSelector, a, d, b, r) {
    const sel = containerSelector + ' .bit[data-a="' + a + '"][data-d="' + d + '"][data-b="' + b + '"][data-r="' + r + '"]';
    const el = document.querySelector(sel);
    if (el) {
      el.classList.add('mirror-flash');
      setTimeout(() => el.classList.remove('mirror-flash'), 600);
    }
  };

  // ============================================================
  // Аллокация пустой bad/miss карты
  // ============================================================
  WFC.makeEmptyValidationMap = function (N) {
    const map = [];
    for (let A = 0; A < N; A++) {
      map.push([]);
      for (let d = 0; d < WFC.DIR_COUNT; d++) {
        map[A].push([]);
        for (let b = 0; b < WFC.NIBBLES_PER_ROW; b++) {
          map[A][d].push([0, 0, 0, 0]);
        }
      }
    }
    return map;
  };

  // ============================================================
  // Имя файла
  // ============================================================
  WFC.fileName = function (path) {
    return path.replace(/\\/g, '/').split('/').pop();
  };

  // ============================================================
  // Текущий режим (для горячих клавиш)
  // ============================================================
  let currentMode = 'horizontal';
  WFC.getCurrentMode = function () { return currentMode; };

  WFC.setupTabs = function () {
    const tabs = document.querySelectorAll('.tab');
    const panes = {
      horizontal: document.getElementById('pane-horizontal'),
      vertical: document.getElementById('pane-vertical'),
    };

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const mode = tab.dataset.mode;
        tabs.forEach(t => t.classList.toggle('active', t === tab));
        for (const k in panes) {
          panes[k].style.display = (k === mode) ? '' : 'none';
        }
        currentMode = mode;
      });
    });
  };
})();
