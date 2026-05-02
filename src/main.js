// ============================================================
// main.js — общий код: парсинг, симметрия, UI-примитивы, табы
// ============================================================

(function () {
  const WFC = {};
  window.WFC = WFC;

  const { open, save } = window.__TAURI__.dialog;
  const { readTextFile, writeTextFile, readDir, exists } = window.__TAURI__.fs;
  const { convertFileSrc } = window.__TAURI__.core;

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
  WFC.tauri = { open, save, readTextFile, writeTextFile, readDir, exists, convertFileSrc };

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
  // ------------------------------------------------------------
  // Формат файла:
  //   {
  //     "completenessMask": [ "...", x6 строк по 16 hex ],
  //     "rotationMap":      [ { "name": "...", "rows": [ x6 строк ] }, ... ]
  //   }
  // completenessMask — оптимизация движка, редактор её не интерпретирует:
  // читает, хранит как есть и пишет обратно без изменений.
  // ============================================================

  function parseHexRow(row, ctx) {
    if (typeof row !== 'string' || row.length !== WFC.NIBBLES_PER_ROW) {
      throw new Error(ctx + ': строка должна быть ' + WFC.NIBBLES_PER_ROW + ' hex-символов');
    }
    return Array.from(row).map(ch => {
      const v = parseInt(ch, 16);
      if (Number.isNaN(v)) throw new Error(ctx + ': невалидный hex "' + ch + '"');
      return v;
    });
  }

  function validateHexTable(rows, ctx) {
    if (!Array.isArray(rows) || rows.length !== WFC.DIR_COUNT) {
      throw new Error(ctx + ': ожидается массив из ' + WFC.DIR_COUNT + ' строк');
    }
    rows.forEach((row, d) => {
      parseHexRow(row, ctx + ', направление ' + d);
    });
    return rows;
  }

  WFC.parseProjectJson = function (text) {
    const data = JSON.parse(text);

    if (Array.isArray(data)) {
      throw new Error('Старый формат файла (массив на корне) больше не поддерживается. ' +
        'Ожидается объект { completenessMask, rotationMap }.');
    }
    if (typeof data !== 'object' || data === null) {
      throw new Error('Корневой JSON должен быть объектом');
    }
    if (!Array.isArray(data.rotationMap)) {
      throw new Error('Отсутствует или некорректное поле rotationMap (должно быть массивом)');
    }
    if (!Array.isArray(data.completenessMask)) {
      throw new Error('Отсутствует или некорректное поле completenessMask (должно быть массивом из ' +
        WFC.DIR_COUNT + ' строк)');
    }

    const completenessMask = validateHexTable(data.completenessMask, 'completenessMask');

    if (data.rotationMap.length < 1 || data.rotationMap.length > WFC.MAX_STATES) {
      throw new Error('Состояний должно быть 1..' + WFC.MAX_STATES + ', получено ' + data.rotationMap.length);
    }
    const states = data.rotationMap.map((entry, idx) => {
      if (typeof entry.name !== 'string') throw new Error('Состояние ' + idx + ': отсутствует name');
      const M = validateHexTable(entry.rows, 'Состояние ' + idx + ', rows')
        .map((row, d) => parseHexRow(row, 'Состояние ' + idx + ', направление ' + d));
      return { name: entry.name, M };
    });

    return { states, completenessMask };
  };

  WFC.serializeProjectJson = function (states, completenessMask) {
    const data = {
      completenessMask,
      rotationMap: states.map(s => ({
        name: s.name,
        rows: s.M.map(row => row.map(n => n.toString(16).toUpperCase()).join(''))
      }))
    };
    return JSON.stringify(data, null, 2);
  };

  WFC.makeEmptyM = function () {
    const M = [];
    for (let d = 0; d < WFC.DIR_COUNT; d++) {
      M.push(new Array(WFC.NIBBLES_PER_ROW).fill(0));
    }
    return M;
  };

  WFC.makeEmptyCompletenessMask = function () {
    return new Array(WFC.DIR_COUNT).fill('0'.repeat(WFC.NIBBLES_PER_ROW));
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
  // Имя файла / пути
  // ============================================================
  WFC.fileName = function (path) {
    return path.replace(/\\/g, '/').split('/').pop();
  };

  WFC.dirName = function (path) {
    const p = path.replace(/\\/g, '/');
    const i = p.lastIndexOf('/');
    return i >= 0 ? p.substring(0, i) : '';
  };

  WFC.stripExt = function (fileName) {
    const i = fileName.lastIndexOf('.');
    return i > 0 ? fileName.substring(0, i) : fileName;
  };

  // ============================================================
  // Система иконок состояний
  // ------------------------------------------------------------
  // Соглашение:
  //   <папка с .json>/icons/<basename без .json>/<state.name>.png
  //
  // Кэш — отдельный на каждый открытый файл (ключ = json path).
  // Сканируем папку один раз при открытии: readDir + map имя→URL.
  // На рендере иконки берутся из кэша за O(1), без I/O.
  // ============================================================

  const iconCaches = new Map();

  const ICON_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.svg'];

  function isIconFile(name) {
    const lo = name.toLowerCase();
    for (let i = 0; i < ICON_EXTS.length; i++) {
      if (lo.endsWith(ICON_EXTS[i])) return true;
    }
    return false;
  }

  WFC.scanIconFolder = async function (jsonPath) {
    const dir = WFC.dirName(jsonPath);
    const base = WFC.stripExt(WFC.fileName(jsonPath));
    const folder = dir + '/icons/' + base;

    const cache = { byName: new Map(), folder };
    iconCaches.set(jsonPath, cache);

    try {
      const has = await exists(folder);
      if (!has) return cache;
      const entries = await readDir(folder);
      for (const e of entries) {
        if (!e || !e.name || !e.isFile) continue;
        if (!isIconFile(e.name)) continue;
        const stateName = WFC.stripExt(e.name);
        const filePath = folder + '/' + e.name;
        const url = convertFileSrc(filePath);
        cache.byName.set(stateName, url);
      }
    } catch (err) {
      console.warn('scanIconFolder:', err);
    }
    return cache;
  };

  WFC.releaseIconCache = function (jsonPath) {
    if (jsonPath) iconCaches.delete(jsonPath);
  };

  WFC.getIconUrl = function (jsonPath, stateName) {
    if (!jsonPath) return null;
    const cache = iconCaches.get(jsonPath);
    if (!cache) return null;
    return cache.byName.get(stateName) || null;
  };

  // ------------------------------------------------------------
  // Фабрика UI-метки состояния.
  // editable=true  — в заголовке стейта: иконка (если есть) + редактируемое имя.
  // editable=false — в шапке колонок таблицы: иконка ИЛИ текст.
  // ------------------------------------------------------------
  WFC.makeStateLabel = function (opts) {
    const { jsonPath, name, editable, onChange } = opts;
    const url = WFC.getIconUrl(jsonPath, name);

    if (!editable) {
      if (url) {
        const img = document.createElement('img');
        img.className = 'state-icon';
        img.src = url;
        img.alt = name;
        img.title = name;
        img.loading = 'lazy';
        img.decoding = 'async';
        img.draggable = false;
        return img;
      }
      const span = document.createElement('span');
      span.className = 'state-name-text';
      span.textContent = name;
      return span;
    }

    const wrap = document.createElement('span');
    wrap.className = 'state-label-wrap';

    if (url) {
      const img = document.createElement('img');
      img.className = 'state-icon header-icon';
      img.src = url;
      img.alt = name;
      img.title = name;
      img.loading = 'lazy';
      img.decoding = 'async';
      img.draggable = false;
      wrap.appendChild(img);
    }

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'statename';
    input.value = name;
    input.addEventListener('input', (e) => onChange && onChange(e.target.value));
    wrap.appendChild(input);

    return wrap;
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
