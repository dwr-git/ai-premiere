/* AI Видео — помощник и файлы на сервере внутри видеоредактора.
 *
 * Панель в браузере разговаривает с моделью через api/assistant.php, а действия
 * выполняет в самом редакторе через window.aipremiere (apps/filmcraft-web/src/bridge.rs):
 * те же методы, что у десктопного канала управления (crates/ui-egui/src/control.rs).
 * Файлы хранятся на вашем сервере (api/files.php), у каждого пользователя свои.
 *
 * Без сборщиков и зависимостей: один файл, подключается из index.html.
 */
(() => {
  'use strict';

  const CFG = Object.assign({
    api: 'api/assistant.php',
    files: 'api/files.php',
    homeUrl: '../',
    labels: 'studio/ru-labels.json',
    fonts: 'fonts/manifest.json',
    autosaveSeconds: 120,      // автосохранение на сервер проекта, который там уже лежит (0 — выключить)
    maxSteps: 40,              // шагов подряд в «Сделай» по умолчанию (в панели: шестерёнка → 10…без ограничений)
    screenshotMax: 1280,       // длинная сторона снимка экрана для модели, px
    openOnStart: false,
    filesOnStart: true,
    aiMaxChars: 60000,         // сколько символов (не больше) отправлять для «ИИ у выделения»
  }, window.STUDIO_CONFIG || {});
  // Страница сборки лежит в b/<номер>/ (studio/build/versioned.sh); адреса из настроек — от папки приложения.
  const fromRoot = (p) => { try { return new URL(p, window.STUDIO_ROOT || document.baseURI).href; } catch { return p; } };
  CFG.api = fromRoot(CFG.api);
  CFG.files = CFG.files ? fromRoot(CFG.files) : CFG.files;
  CFG.homeUrl = fromRoot(CFG.homeUrl || '../');
  // Редактор сам читает адрес домика из настроек.
  window.STUDIO_CONFIG = Object.assign(window.STUDIO_CONFIG || {}, { homeUrl: CFG.homeUrl });

  const READ_TOOLS = new Set(['find_commands', 'get_state', 'clip_details', 'list_captions', 'list_effects', 'look_at_screen']);
  // Никогда: файлы проекта (их делает панель), служебное и интерфейс, настройки, медиа на диске.
  const DENY = /^(app\.|ui\.|window\.|view\.|mode\.|test\.|perf\.|events\.|command\.|prefs\.|shortcuts\.|keyboard\.|mediaBrowser\.|mediaCache\.|history\.(clear|deleteRedoable)|file\.(open|openDemoProject|openRecent|newProject|newProjectFromTemplate|save|saveAs|saveAll|saveCopy|saveAsTemplate|import|importAaf|importImageSequence|importFromMediaBrowser|recover|close|exportSelectionProject)\b|media\.(makeOffline|createProxies|attachProxies|detachProxies|reconnectFullRes|search|autoRelink|replaceFootage)|projectManager\.|presets\.(import|export)|export\.presets\.(import|export))/i;
  // Только после подтверждения пользователя.
  const CONFIRM = /^(sequence\.(deleteTracks?|simplify)|captions\.(deleteTrack|delete)\b|markers\.(clearAll|delete)\b|edit\.(clear|removeUnused)\b|timeline\.delete\b|project\.delete\b)/i;

  // ------------------------------------------------------------------ мост к редактору
  const VC = () => window.aipremiere;
  const PC = {
    ready: () => !!(VC() && typeof VC().request === 'function'),
    async call(method, params) {
      if (!PC.ready()) throw new Error('Редактор ещё загружается');
      return VC().request(method, params ?? {});
    },
    exec(id, params) {
      const p = params && typeof params === 'object' && !Array.isArray(params) ? params : {};
      return PC.call('engine.execute', { command: id, params: p });
    },
  };
  // Для своих скриптов и отладки из консоли: await aipremiereStudio.exec('markers.add', {name: 'Здесь'})
  window.aipremiereStudio = { call: PC.call, exec: PC.exec };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const withTimeout = (p, ms, what) => Promise.race([p, sleep(ms).then(() => { throw new Error(what + ': нет ответа'); })]);
  const clip = (s, n) => (s.length > n ? s.slice(0, n) + '…[обрезано]' : s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem('aipremiere.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('aipremiere.' + k, JSON.stringify(v)); } catch { /* приватный режим */ } },
  };

  // ------------------------------------------------------------------ русские названия
  let L = { text: {}, id: {} };
  const labelsLoaded = fetch(CFG.labels).then((r) => (r.ok ? r.json() : L)).then((j) => { L = j; }).catch(() => {});
  function ru(label) {
    if (!label) return '';
    if (L.text[label]) return L.text[label];
    const bare = label.replace(/(…|\.\.\.)$/, '');
    if (bare !== label && L.text[bare]) return L.text[bare] + '…';
    return label;
  }
  // Путь в меню: у команд движка — список, у команд интерфейса — строка «Window > Mix».
  const menuOf = (c) => (Array.isArray(c.menu) ? c.menu : String(c.location || c.menu || '').split(/›|>/)).map((x) => String(x).trim()).filter(Boolean);
  const ruName = (c) => L.id[c.id] || ru(c.label);
  const ruPath = (c) => [...menuOf(c).map(ru), ruName(c)].join(' › ');

  // ------------------------------------------------------------------ поиск команд
  let catalog = null;
  let catalogAt = 0;
  async function commands() {
    if (!catalog || Date.now() - catalogAt > 30000) {
      const r = await PC.call('engine.commands');
      catalog = Array.isArray(r) ? r : (r && Array.isArray(r.commands) ? r.commands : []);
      catalogAt = Date.now();
    }
    return catalog;
  }
  // Частые просьбы → слова, которыми такие команды называются.
  const SYN = [
    [/разрез|разделит|резать|склейк|лезви/, 'razor add edit'], [/удал\S* со сдвиг|без дыр|сомкн|пуст/, 'ripple delete close gap'], [/удал/, 'clear delete ripple'],
    [/подрез|обрез|тримм|укорот|удлин/, 'trim ripple roll'], [/сдвин|перемест|сместит/, 'move nudge slide'], [/выдел/, 'select'],
    [/переход|растворен|затемнен|плавн/, 'transition dissolve dip'], [/титр|надпис|текст/, 'graphics text title'], [/субтитр|подпис/, 'captions caption'],
    [/маркер|метк|глав/, 'marker markers'], [/цвет|яркост|контраст|насыщ|экспоз|баланс|цветокор/, 'lumetri color effects'],
    [/громк|звук|аудио|выровн|нормализ/, 'audio gain loudness essential sound normalize'], [/музык|приглуш|дакин/, 'ducking essential sound music'],
    [/скорост|замедл|ускор|реверс|задом/, 'speed duration reverse'], [/стоп-?кадр|заморо/, 'frame hold'], [/последоват|секвенц/, 'sequence new settings'],
    [/вертикал|9:16|квадрат|размер кадр/, 'sequence settings new'], [/экспорт|вывод|рендер|скачат|сохранит\S* видео|mp4/, 'export media quick'],
    [/эффект|фильтр|размыт/, 'effects apply'], [/ключев|анимац|keyframe/, 'keyframe animation'], [/дорожк|трек/, 'track add tracks'],
    [/вложен|nest/, 'nest'], [/переимен|назван|имя/, 'rename name'], [/вход|выход/, 'mark in out'], [/отмен/, 'undo'], [/указател|playhead/, 'playhead'],
    [/масштаб|позици|кадрир|вписат/, 'motion scale fit frame'], [/сцен/, 'scene edit detection'],
  ];
  const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е');
  async function findCommands(query) {
    const all = await commands();
    await labelsLoaded;
    const q = norm(query).trim();
    if (!q) return { results: [], hint: 'Пустой запрос' };
    const terms = new Set(q.split(/[^\p{L}\p{N}.]+/u).filter((t) => t.length > 1));
    for (const [re, words] of SYN) if (re.test(q)) words.split(' ').forEach((w) => terms.add(w));
    const scored = [];
    for (const c of all) {
      if (DENY.test(c.id)) continue;
      const name = norm(ruName(c));
      const en = norm(c.label);
      const path = norm(menuOf(c).map(ru).join(' ') + ' ' + menuOf(c).join(' '));
      const id = norm(c.id);
      let s = 0;
      if (name === q || en === q) s += 20;
      else if (name.includes(q) || en.includes(q)) s += 10;
      for (const t of terms) {
        if (name.includes(t)) s += name.startsWith(t) ? 7 : 5;
        if (en.includes(t)) s += en.startsWith(t) ? 6 : 4;
        if (id.includes(t)) s += 3;
        if (path.includes(t)) s += 1;
      }
      if (s > 0) scored.push([s + (c.params && c.params !== '{}' ? 1 : 0), c]);
    }
    scored.sort((a, b) => b[0] - a[0]);
    const results = scored.slice(0, 10).map(([, c]) => ({
      id: c.id,
      name: ruName(c),
      menu: ruPath(c),
      shortcut: c.shortcut || undefined,
      params: c.params && c.params !== '{}' ? clip(String(c.params), 600) : undefined,
    }));
    return results.length ? { results } : { results: [], hint: 'Ничего не найдено. Попробуй другие слова, можно по-английски (например: razor, ripple delete, transition, text, captions, gain, marker, export).' };
  }
  // ------------------------------------------------------------------ состояние и снимок экрана
  // Время в движке — тики (254016000000 в секунде); модели и человеку — секунды.
  const TPS = 254016000000;
  const secs = (t) => (Number.isFinite(Number(t)) ? Math.round((Number(t) / TPS) * 100) / 100 : t);
  const ticks = (s) => Math.round(Number(s) * TPS);
  const project = () => PC.exec('project.inspect');
  const sequence = () => PC.exec('sequence.inspect').catch(() => null);
  const captionTracks = () => PC.exec('captions.list').then((r) => r || { tracks: [] }).catch(() => ({ tracks: [] }));
  // Элементы проекта (медиа, последовательности, титры) списком: id, имя, тип, длина.
  function projectItems(p) {
    const out = [];
    const walk = (b, depth) => {
      for (const c of (b && b.children) || []) {
        if (c.item != null) out.push({ item: c.item, name: c.name, type: c.type, seconds: secs(c.duration) });
        else if (depth < 12) walk(c, depth + 1);
      }
    };
    walk(p && p.root, 0);
    return out;
  }
  function clipSummary(c, types) {
    const o = { clip: c.clip, name: c.name, item: c.item, start: secs(c.start), length: secs(c.duration) };
    const type = types.get(c.item);
    if (type) o.type = type;
    if (c.speed && c.speed !== 1 && c.speed !== 100) o.speed = c.speed;
    if (c.reverse) o.reverse = true;
    if (c.gainDb) o.gain_db = Math.round(c.gainDb * 10) / 10;
    if (c.enabled === false) o.disabled = true;
    const fx = (c.effects || []).map((e) => e.effect).filter((e) => !['motion', 'opacity', 'volume', 'channel_volume', 'panner', 'time_remap'].includes(e));
    if (fx.length) o.effects = fx;
    return o;
  }
  function trackSummary(t, kind, types, maxClips) {
    const o = { id: t.id, name: t.name, kind };
    if (t.muted) o.muted = true;
    if (t.locked) o.locked = true;
    if (t.enabled === false) o.hidden = true;
    const items = t.items || [];
    o.clips = items.slice(0, maxClips).map((c) => clipSummary(c, types));
    if (items.length > maxClips) o.more_clips = items.length - maxClips;
    const tr = (t.transitions || []).map((x) => ({ effect: x.effect, start: secs(x.start), length: secs(x.duration), from: x.from, to: x.to }));
    if (tr.length) o.transitions = tr.slice(0, 40);
    return o;
  }
  // Текущий проект: имя, сохранён ли, последовательность, дорожки с клипами, маркеры, субтитры, выделение.
  async function snapshot() {
    const state = {};
    try {
      const p = await project();
      state.project = p.name;
      state.unsaved = !!p.dirty;
      state.onServer = !!p.path && Files.isServer(p.path);
      const items = projectItems(p);
      const types = new Map(items.map((i) => [i.item, i.type]));
      state.media = items.slice(0, 60);
      if (items.length > 60) state.more_media = items.length - 60;
      const q = await sequence();
      if (!q) {
        state.note = items.length
          ? 'Последовательность не открыта. Создать: file.newSequence {name} или file.newSequence {fromItem: id элемента}.'
          : 'Проект пуст. Видео можно открыть из «Моих проектов» или с компьютера (Файл › Импорт), затем создать последовательность.';
        return state;
      }
      const st = q.settings || {};
      state.sequence = { id: q.id, name: q.name, width: st.width, height: st.height, fps: st.frame_rate || st.fps || st.frameRate, length_seconds: secs(q.duration) };
      state.playhead = secs(q.playhead);
      if (q.in != null || q.out != null) state.in_out = [secs(q.in), secs(q.out)];
      state.video_tracks = (q.video || []).map((t, i) => trackSummary(t, 'V' + (i + 1), types, 40));
      state.audio_tracks = (q.audio || []).map((t, i) => trackSummary(t, 'A' + (i + 1), types, 40));
      state.markers = (q.markers || []).slice(0, 60).map((m) => ({ id: m.id, name: m.name, comment: m.comment || undefined, at: secs(m.start), ...(m.duration ? { length: secs(m.duration) } : {}) }));
      const caps = await captionTracks();
      const ct = (caps.tracks || []).map((t) => ({ id: t.id, label: t.label, name: t.name, language: t.language, captions: (t.captions || []).length }));
      if (ct.length) state.caption_tracks = ct;
      state.selection = { clips: q.selection || [], captions: caps.selection || [] };
    } catch (e) {
      state.note = 'Редактор ещё загружается: ' + e.message;
    }
    return state;
  }
  // Один клип подробно: эффекты с параметрами; для титра — слои с текстом.
  async function clipDetails(id) {
    const q = await sequence();
    if (!q) throw new Error('Последовательность не открыта');
    const want = Number(id);
    for (const [kind, list] of [['V', q.video || []], ['A', q.audio || []]]) {
      for (let i = 0; i < list.length; i++) {
        const c = (list[i].items || []).find((x) => x.clip === want);
        if (!c) continue;
        const o = { track: kind + (i + 1), clip: c.clip, name: c.name, item: c.item, start: secs(c.start), length: secs(c.duration), source_in: secs(c.sourceIn), speed: c.speed, reverse: c.reverse, gain_db: c.gainDb, enabled: c.enabled, effects: c.effects };
        try {
          const g = await PC.exec('graphics.list', { clip: want });
          o.layers = (g.layers || []).map((l) => ({ layer: l.layer, name: l.name, kind: l.kind, text: l.text || undefined }));
        } catch { /* не титр */ }
        return o;
      }
    }
    throw new Error(`Нет клипа ${id}. Список клипов — в get_state.`);
  }
  async function listCaptions() {
    const caps = await captionTracks();
    return {
      tracks: (caps.tracks || []).map((t) => ({
        id: t.id, label: t.label, name: t.name, language: t.language,
        captions: (t.captions || []).slice(0, 400).map((c) => ({ id: c.id, start: secs(c.start), end: secs(c.end), text: c.text })),
      })),
      selection: caps.selection || [],
    };
  }

  function downscale(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, CFG.screenshotMax / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * k));
        c.height = Math.max(1, Math.round(img.height * k));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.75).split(',')[1]);
      };
      img.onerror = () => reject(new Error('не удалось прочитать снимок'));
      img.src = src;
    });
  }
  async function screenshot() {
    if (!PC.ready()) return null;
    try {
      const r = await withTimeout(VC().screenshot(), 9000, 'снимок');
      const b64 = r && (r.png_base64 || r.png || r.pngBase64 || r.data);
      if (typeof b64 === 'string' && b64.length > 100) return await downscale('data:image/png;base64,' + b64);
    } catch { /* ниже */ }
    return null;
  }

  // ------------------------------------------------------------------ интерфейс
  const ICON = {
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/></svg>',
    spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z"/><path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/></svg>',
    bulb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/></svg>',
    hand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4l6 6-9 9H5v-6z"/><path d="M12.5 5.5l6 6"/></svg>',
    sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    palette: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22a10 10 0 1 1 10-10c0 2.8-2.2 4-4 4h-2.2a2 2 0 0 0-1.4 3.4A1.6 1.6 0 0 1 12 22z"/><circle cx="7.5" cy="10.5" r="1.2"/><circle cx="12" cy="7.5" r="1.2"/><circle cx="16.5" cy="10.5" r="1.2"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M13 5l7 7-7 7M5 5l7 7-7 7"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13M13 6l6 6-6 6"/></svg>',
    stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>',
    // Мозг — контур из набора Tabler Icons (MIT), нарисованный градиентом #st-brain-grad.
    brain: '<svg class="st-brain-svg" viewBox="0 0 24 24" fill="none" stroke="url(#st-brain-grad)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15.5 13a3.5 3.5 0 0 0 -3.5 3.5v1a3.5 3.5 0 0 0 7 0v-1.8"/><path d="M8.5 13a3.5 3.5 0 0 1 3.5 3.5v1a3.5 3.5 0 0 1 -7 0v-1.8"/><path d="M17.5 16a3.5 3.5 0 0 0 0 -7h-.5"/><path d="M19 9.3v-2.8a3.5 3.5 0 0 0 -7 0"/><path d="M6.5 16a3.5 3.5 0 0 1 0 -7h.5"/><path d="M5 9.3v-2.8a3.5 3.5 0 0 1 7 0v10"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    layout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/></svg>',
    folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/></svg>',
    bolt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 3l-8 11h6l-1 7 8-11h-6z"/></svg>',
  };
  // Живой контур: мозг градиентом и три точки на орбите, пока помощник работает.
  const BRAIN = `${ICON.brain}<b class="st-orbit" aria-hidden="true"><i></i><i></i><i></i></b>`;

  const root = document.createElement('div');
  root.id = 'studio-root';
  root.dataset.theme = 'light';
  root.innerHTML = `
    <svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><linearGradient id="st-brain-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8fa2ff"/><stop offset=".55" stop-color="#9b7cf0"/><stop offset="1" stop-color="#ff77c6"/></linearGradient></defs></svg>
    <div class="st-veil" aria-hidden="true"></div>
    <div class="st-drop" aria-hidden="true"><span>Отпустите, чтобы открыть в редакторе</span></div>
    <aside class="st-panel" aria-label="Помощник">
      <header class="st-head">
        <div class="st-logo st-brain st-raised-sm" aria-hidden="true">${BRAIN}</div>
        <div class="st-title"><b>Помощник</b><small data-ref="sub">Загрузка редактора…</small></div>
        <button class="st-icon-btn" data-ref="galleryBtn" title="Быстрые задачи: переходы, титры, субтитры, звук, экспорт…" aria-label="Быстрые задачи">${ICON.layout}</button>
        <button class="st-icon-btn" data-ref="filesBtn" title="Мои файлы (на сервере)" aria-label="Мои файлы">${ICON.folder}</button>
        <button class="st-icon-btn" data-ref="barBtn" title="Быстрая строка (Ctrl+Shift+Пробел)" aria-label="Быстрая строка">${ICON.bolt}</button>
        <div class="st-theme-wrap">
          <button class="st-icon-btn" data-ref="theme" title="Тема оформления" aria-label="Тема оформления" aria-haspopup="menu" aria-expanded="false">${ICON.palette}</button>
          <div class="st-theme-menu" data-ref="themeMenu" role="menu" hidden></div>
        </div>
        <button class="st-icon-btn" data-ref="hide" title="Свернуть панель" aria-label="Свернуть панель">${ICON.close}</button>
      </header>
      <div class="st-seg st-pressed" role="group" aria-label="Режим помощника">
        <button data-mode="advice" aria-pressed="true">${ICON.bulb}Совет</button>
        <button data-mode="act" aria-pressed="false">${ICON.hand}Сделай</button>
      </div>
      <div class="st-mode-hint" data-ref="hint"></div>
      <div class="st-log" data-ref="log" role="log" aria-live="polite"></div>
      <div class="st-composer">
        <div class="st-input st-pressed">
          <button class="st-icon-btn" data-ref="eye" aria-pressed="true" title="Показывать помощнику экран" aria-label="Показывать помощнику экран">${ICON.eye}</button>
          <textarea data-ref="input" rows="1" placeholder="Спросите или попросите…" aria-label="Сообщение помощнику"></textarea>
          <button class="st-send" data-ref="send" title="Отправить (Enter)" aria-label="Отправить">${ICON.send}</button>
        </div>
        <div class="st-foot"><span>Ctrl+Z — отменить</span><span class="st-agent-wrap"><button data-ref="agentBtn" title="Сколько шагов подряд делать и спрашивать ли перед удалением" aria-haspopup="menu" aria-expanded="false">${ICON.gear}Настройки</button><span class="st-theme-menu st-agent-menu" data-ref="agentMenu" role="menu" hidden></span></span><button data-ref="clear">Новый разговор</button></div>
      </div>
    </aside>
    <div class="st-files" data-ref="files" role="dialog" aria-modal="true" aria-label="Мои файлы" hidden>
      <div class="st-files-box">
        <header class="st-files-head">
          <b>Мои проекты</b><small data-ref="filesWho"></small>
          <button class="st-icon-btn" data-ref="filesClose" title="Закрыть (Esc)" aria-label="Закрыть">${ICON.x}</button>
        </header>
        <div class="st-files-tools">
          <input data-ref="filesSearch" type="search" placeholder="Поиск по имени" aria-label="Поиск по имени">
          <button class="st-mini" data-ref="filesNew">Новый проект</button>
          <button class="st-mini" data-ref="filesUpload" title="Проект .fcproj или медиа: видео MP4, MOV, MKV, WebM…, звук, картинки, субтитры SRT/VTT (в панель «Проект»)">С компьютера…</button>
        </div>
        <div class="st-files-list" data-ref="filesList"></div>
        <footer class="st-files-foot">
          <span data-ref="filesCurrent"></span>
          <button class="st-mini" data-ref="filesSaveAs">Сохранить как…</button>
          <button class="st-mini primary" data-ref="filesSave">Сохранить</button>
        </footer>
      </div>
    </div>
    <div class="st-files st-gallery" data-ref="gallery" role="dialog" aria-modal="true" aria-label="Быстрые задачи" hidden>
      <div class="st-files-box st-gallery-box">
        <header class="st-files-head">
          <b>Быстрые задачи</b>
          <small>В одно нажатие. Действуют на выделенные клипы, а если ничего не выделено — на всю открытую последовательность.</small>
          <button class="st-icon-btn" data-ref="galleryClose" title="Закрыть (Esc)" aria-label="Закрыть">${ICON.x}</button>
        </header>
        <div class="st-gpane"><div class="st-gtasks" data-ref="gTasks"></div></div>
      </div>
    </div>
    <div class="st-ask" data-ref="ask" role="dialog" aria-modal="true" hidden>
      <form class="st-ask-box">
        <b data-ref="askTitle"></b>
        <input data-ref="askInput" type="text" maxlength="120">
        <small data-ref="askNote"></small>
        <div class="st-row"><button type="button" class="st-mini" data-ref="askCancel">Отмена</button><button type="submit" class="st-mini primary" data-ref="askOk">OK</button></div>
      </form>
    </div>
    <button class="st-fab st-brain" data-ref="fab" title="Помощник" aria-label="Открыть помощника">${BRAIN}<span class="st-badge" aria-hidden="true"></span></button>
    <div class="st-bar" data-ref="bar" role="dialog" aria-label="Быстрая строка помощника">
      <div class="st-bar-answer" data-ref="barAnswer"></div>
      <div class="st-bar-row">
        <button class="st-bar-mode" data-ref="barMode" title="Режим: Совет или Сделай"></button>
        <input data-ref="barInput" type="text" placeholder="Что сделать с роликом? Enter — отправить, Esc — закрыть" aria-label="Запрос помощнику">
        <button class="st-send" data-ref="barSend" aria-label="Отправить">${ICON.send}</button>
      </div>
    </div>`;
  const $ = (name) => root.querySelector(`[data-ref="${name}"]`);
  const log = $('log');
  const input = $('input');

  // Клавиши, набранные в панели, не должны доходить до редактора (иначе «B» выберет кисть).
  for (const type of ['keydown', 'keyup', 'keypress', 'paste', 'copy', 'cut']) {
    root.addEventListener(type, (e) => e.stopPropagation());
  }

  let mode = store.get('mode', 'advice');
  let attachScreen = store.get('eye', true);
  let busy = false;
  let stopRequested = false;
  let convo = [];

  const HINTS = {
    advice: 'Объясняю и подсказываю, ничего не меняю в проекте.',
    act: 'Делаю сам: режу и склеиваю, ставлю переходы, титры и субтитры, правлю цвет и звук, ставлю маркеры, вывожу ролик. Всё отменяется Ctrl+Z.',
  };
  // Модель видит всю переписку. Если раньше она писала «я в режиме Совет», то по инерции продолжает
  // так отвечать и после переключения. Поэтому смена режима отмечается прямо в разговоре,
  // а каждое сообщение пользователя несёт текущий режим.
  const MODE_NOTE = {
    act: '[Режим переключён на «Сделай». Теперь ты сам выполняешь просьбы инструментами (get_state, run_command, set_playhead, select_clips…). Всё, что ты раньше писал про режим «Совет», больше не действует.]',
    advice: '[Режим переключён на «Совет». Теперь только объясняй и подсказывай, ничего не меняй в проекте.]',
  };
  const MODE_TAG = {
    act: '[Режим сейчас: «Сделай» — выполни это сам, инструментами]',
    advice: '[Режим сейчас: «Совет» — объясни, как сделать, ничего не меняя]',
  };
  function setMode(m) {
    const next = m === 'act' ? 'act' : 'advice';
    if (next !== mode && convo.length) convo.push({ role: 'user', content: MODE_NOTE[next] });
    mode = next;
    store.set('mode', mode);
    root.querySelectorAll('.st-seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    $('hint').textContent = HINTS[mode];
    const bm = root.querySelector('[data-ref="barMode"]');
    if (bm) bm.textContent = mode === 'act' ? 'Сделай' : 'Совет';
  }
  function setEye(on) {
    attachScreen = !!on;
    store.set('eye', attachScreen);
    $('eye').setAttribute('aria-pressed', String(attachScreen));
    $('eye').title = attachScreen ? 'Помощник видит экран' : 'Помощник не видит экран';
  }
  function setOpen(open) {
    root.classList.toggle('open', open);
    document.body.classList.toggle('studio-open', open);
    setTimeout(syncBackdrop, 60);
    setTimeout(syncBackdrop, 400);
    store.set('open', open);
    // eframe подхватывает новый размер canvas на следующем кадре
    window.dispatchEvent(new Event('resize'));
    if (open) { setTimeout(() => input.focus(), 200); root.classList.remove('has-hints'); }
  }
  function setBusy(on) {
    busy = on;
    root.classList.toggle('busy', on);
    $('send').innerHTML = on ? ICON.stop : ICON.send;
    $('send').title = on ? 'Остановить' : 'Отправить (Enter)';
  }
  function scroll() { log.scrollTop = log.scrollHeight; }

  function format(text) {
    // Строки списка «- …» / «* …» — с точкой; короткая строка, оканчивающаяся двоеточием, — заголовок.
    text = text.trim().split('\n').map((line) => {
      const li = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
      if (li) return '\u0001' + (/^\s*\d/.test(line) ? line.trim().match(/^\d+[.)]/)[0] + ' ' : '• ') + li[1] + '\u0002';
      const head = line.match(/^\s*(?:#{1,4}\s*)?\**([^*:]{2,60}):\**\s*$/);
      if (head) return '\u0003' + head[1] + ':\u0004';
      return line.replace(/^#{1,4}\s+/, '');
    }).join('\n').replace(/\u0002\n/g, '\u0002');  // пункт списка — блок: перенос после него лишний
    let h = esc(text);
    h = h.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    h = h.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
    h = h.replace(/\((Ctrl|Shift|Alt|Cmd|⌘|⇧|⌥)([^)\n]{0,24})\)/g, '(<kbd>$1$2</kbd>)');
    // «Изображение › Коррекция › Кривые» — путь в меню
    // Сегменты — слова через одиночные пробелы: конечный пробел не должен «съедать» разделитель.
    const C = '[^\\s›«»"():.,!?;<>&]';
    const word = `${C}+`;
    const path = new RegExp(`([А-ЯЁA-Z]${C}*(?: ${word}){0,2}(?: › ${word}(?: ${word}){0,3}){1,4})`, 'g');
    h = h.replace(path, '<span class="st-path">$1</span>');
    h = h.replace(/\u0001/g, '<span class="st-li">').replace(/\u0002/g, '</span>')
      .replace(/\u0003/g, '<span class="st-h">').replace(/\u0004/g, '</span>');
    return h;
  }
  function add(el) { log.querySelector('.st-empty')?.remove(); log.appendChild(el); scroll(); return el; }
  function msg(cls, html) { const d = document.createElement('div'); d.className = 'st-msg ' + cls; d.innerHTML = html; return add(d); }
  function typing(on) {
    log.querySelector('.st-typing')?.remove();
    if (on) { const t = document.createElement('div'); t.className = 'st-typing st-raised-sm'; t.innerHTML = '<i></i><i></i><i></i>'; add(t); }
  }

  const ACTION_TEXT = {
    find_commands: (a) => ['Ищу команду', a.query],
    get_state: () => ['Смотрю проект', ''],
    clip_details: (a) => ['Смотрю клип', a.clip != null ? String(a.clip) : ''],
    list_captions: () => ['Читаю субтитры', ''],
    list_effects: (a) => ['Смотрю эффекты', a.kind || ''],
    set_playhead: (a) => ['Ставлю указатель', `${a.seconds ?? 0} с`],
    select_clips: (a) => ['Выделяю клипы', Array.isArray(a.clips) && a.clips.length ? a.clips.join(', ') : 'снимаю выделение'],
    look_at_screen: () => ['Смотрю на экран', ''],
    undo: (a) => ['Отменяю', `${a.steps || 1} шаг(а)`],
  };
  function card(name, args, label) {
    const d = document.createElement('div');
    const [title, detail] = label || (ACTION_TEXT[name] ? ACTION_TEXT[name](args) : [name, '']);
    d.className = 'st-act' + (READ_TOOLS.has(name) ? ' read' : '');
    d.innerHTML = `<span class="st-dot"></span><div class="st-act-text"><b>${esc(title)}</b>${detail ? `<small>${esc(detail)}</small>` : ''}</div>`;
    return add(d);
  }
  function cardResult(d, ok, error, undoable) {
    if (!ok) {
      d.classList.add('fail');
      const s = d.querySelector('small') || d.querySelector('.st-act-text').appendChild(document.createElement('small'));
      s.textContent = error;
      return;
    }
    if (undoable) {
      const b = document.createElement('button');
      b.className = 'st-mini';
      b.textContent = 'Отменить';
      b.onclick = async () => {
        b.disabled = true;
        const steps = typeof undoable === 'number' ? undoable : 1;
        try { for (let i = 0; i < steps; i++) await PC.exec('edit.undo'); b.textContent = 'Отменено'; } catch (e) { b.textContent = 'Не вышло'; b.title = e.message; }
      };
      d.appendChild(b);
    }
  }
  // ------------------------------------------------------------------ настройки помощника
  // Сколько шагов подряд делать в «Сделай» (потом — кнопка «Продолжить») и спрашивать ли перед
  // удалением, закрытием, сбросом. Хранятся в этом браузере; меню — «Настройки» внизу панели.
  const STEP_CHOICES = [10, 25, 40, 100, 0]; // 0 — без ограничений
  const stepSetting = () => { const v = Number(store.get('agentSteps', CFG.maxSteps)); return Number.isFinite(v) && v >= 0 ? v : CFG.maxSteps; };
  const agentSteps = () => (stepSetting() > 0 ? stepSetting() : Infinity);
  const askBeforeRisky = () => store.get('agentConfirm', true) !== false;
  function renderAgentMenu() {
    const menu = $('agentMenu');
    if (!menu) return;
    const cur = stepSetting();
    menu.innerHTML = '<div class="st-menu-title">Шагов подряд в «Сделай»</div>'
      + STEP_CHOICES.map((n) => `<button role="menuitemradio" aria-checked="${n === cur}" data-steps="${n}">${n ? n : 'Без ограничений'}</button>`).join('')
      + '<hr><label class="st-menu-check"><input type="checkbox" data-k="agentConfirm"' + (askBeforeRisky() ? ' checked' : '') + '><span>Спрашивать перед удалением, закрытием и сбросом</span></label>'
      + '<label class="st-menu-check"><input type="checkbox" data-k="agentLook"' + (store.get('agentLook', true) ? ' checked' : '') + '><span>Смотреть на результат после каждой серии шагов (если включён «глаз»)</span></label>';
    menu.querySelectorAll('[data-steps]').forEach((b) => { b.onclick = () => { store.set('agentSteps', Number(b.dataset.steps)); renderAgentMenu(); }; });
    menu.querySelectorAll('input[data-k]').forEach((c) => { c.onchange = () => store.set(c.dataset.k, c.checked); });
  }
  function toggleAgentMenu(open) {
    const menu = $('agentMenu');
    if (!menu) return;
    const show = open == null ? menu.hidden : open;
    if (show) renderAgentMenu();
    menu.hidden = !show;
    $('agentBtn').setAttribute('aria-expanded', String(show));
  }
  function initAgentMenu() {
    const btn = $('agentBtn');
    if (!btn) return;
    btn.onclick = (e) => { e.stopPropagation(); toggleAgentMenu(); };
    document.addEventListener('pointerdown', (e) => {
      const menu = $('agentMenu');
      if (menu && !menu.hidden && !menu.contains(e.target) && e.target !== btn && !btn.contains(e.target)) toggleAgentMenu(false);
    }, true);
  }
  let allowAllThisTurn = false;
  let autoAllowNoted = false;
  function confirmAction(text) {
    if (!askBeforeRisky() || allowAllThisTurn) {
      if (!autoAllowNoted) {
        autoAllowNoted = true;
        msg('note', 'Необратимые действия выполняю без вопроса — так выбрано. Вернуть вопросы: «Настройки» внизу панели. Отменить шаг — Ctrl+Z.');
      }
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      const d = document.createElement('div');
      d.className = 'st-confirm st-raised';
      d.innerHTML = `<p>${esc(text)}</p>`
        + '<label class="st-confirm-check"><input type="checkbox"> Больше не спрашивать (вернуть — «Настройки» внизу панели)</label>'
        + '<div class="st-row"><button class="st-mini danger" data-a="no">Не надо</button>'
        + '<button class="st-mini" data-a="all" title="Не спрашивать до конца этой просьбы">Разрешать всё в этой задаче</button>'
        + '<button class="st-mini" data-a="yes">Разрешить</button></div>';
      add(d);
      d.querySelectorAll('button').forEach((b) => {
        b.onclick = () => {
          const yes = b.dataset.a !== 'no';
          if (yes && d.querySelector('input').checked) store.set('agentConfirm', false);
          if (b.dataset.a === 'all') allowAllThisTurn = true;
          d.remove();
          resolve(yes);
        };
      });
    });
  }

  function showEmpty() {
    log.innerHTML = `<div class="st-empty">
      <h3>Чем помочь?</h3>
      <p>Спросите, где найти функцию в AI Видео, или попросите смонтировать за вас: разрезать, поставить переходы, титры и субтитры, выровнять звук, вывести ролик.</p>
      <button class="st-mini primary st-start-tpl">Быстрые задачи</button>
      <div class="st-chips">
        <button class="st-chip" data-act="1">Поставь плавные переходы между всеми клипами на V1 и в звуке</button>
        <button class="st-chip" data-act="1">Добавь в начало титр с названием ролика: </button>
        <button class="st-chip" data-act="1">Выровняй громкость голоса и приглуши музыку под речью</button>
        <button class="st-chip">Разбери монтаж: что на дорожках и что стоит улучшить?</button>
        <button class="st-chip">Как сделать вертикальное видео для соцсетей из этого проекта?</button>
      </div></div>`;
    const st = log.querySelector('.st-start-tpl');
    if (st) st.onclick = () => Gallery.show(true);
    log.querySelectorAll('.st-chip').forEach((c) => {
      c.onclick = () => {
        if (c.dataset.act) setMode('act');
        input.value = c.textContent;
        if (/:\s*$/.test(c.textContent)) { autosize(); input.focus(); input.setSelectionRange(input.value.length, input.value.length); return; }
        send();
      };
    });
  }

  // ------------------------------------------------------------------ инструменты для модели
  async function commandById(id) {
    const c = (await commands()).find((x) => x.id === id);
    if (!c) throw new Error(`Нет команды «${id}». Найди нужную через find_commands.`);
    if (DENY.test(id)) throw new Error('Эту команду помощнику выполнять нельзя (файлы, интерфейс и служебное делает панель или сам пользователь).');
    return c;
  }
  const short = (v) => (v === undefined || v === null ? { ok: true } : { ok: true, result: v });
  const trimJson = (v, n) => JSON.parse(clip(JSON.stringify(v), n).replace(/…\[обрезано\]$/, '') || 'null');

  // Команды, которые только смотрят или выделяют: их не нужно отменять кнопкой.
  const NOT_UNDOABLE = /^(edit\.(selectAll|deselectAll|copy)|timeline\.(select|selectGap)|playhead\.|markers\.(go|markIn|markOut|clear(In|Out|InOut)\b)|captions\.(select|next|previous|goTo|list|export)|effects\.(list|select)|graphics\.(list|template\.list)|[a-z]+\.inspect|project\.(inspect|items)|export\.(formats|presets\.list|presets\.get|resolve|queue\.list)|file\.exportMedia|sequence\.(open|close)|source\.)/;
  async function runTool(name, args) {
    if (mode !== 'act' && !READ_TOOLS.has(name)) {
      return { ok: false, error: 'Сейчас режим «Совет»: действия выключены. Объясни пользователю, как сделать это самому, или предложи переключиться в «Сделай».' };
    }
    const attempt = async (d, fn) => { try { const r = await fn(); cardResult(d, true); return r; } catch (e) { cardResult(d, false, e.message); return { ok: false, error: e.message }; } };
    switch (name) {
      case 'find_commands': {
        const d = card(name, args);
        const r = await findCommands(String(args.query || ''));
        cardResult(d, true);
        return r;
      }
      case 'get_state': {
        card(name, args);
        return await snapshot();
      }
      case 'clip_details': {
        const d = card(name, args);
        return attempt(d, async () => short(trimJson(await clipDetails(args.clip ?? args.id), 8000)));
      }
      case 'list_captions': {
        const d = card(name, args);
        return attempt(d, async () => short(trimJson(await listCaptions(), 12000)));
      }
      case 'list_effects': {
        const d = card(name, args);
        return attempt(d, async () => short(trimJson(await PC.exec('effects.list', args.kind ? { kind: String(args.kind) } : {}), 8000)));
      }
      case 'look_at_screen': {
        const d = card(name, args);
        const img = await screenshot();
        cardResult(d, !!img, 'Снимок не получился');
        return img ? { ok: true, note: 'Снимок приложен следующим сообщением.', __image: img } : { ok: false, error: 'Снимок экрана не получился' };
      }
      case 'run_command': {
        const c = await commandById(String(args.id || ''));
        if (CONFIRM.test(c.id) && !(await confirmAction(`Помощник хочет выполнить «${ruPath(c)}». Разрешить?`))) {
          card(name, args, ['Пропущено пользователем', ruPath(c)]).classList.add('fail');
          return { ok: false, error: 'Пользователь не разрешил это действие. Не повторяй его, спроси, как поступить.' };
        }
        const d = card(name, args, ['Выполняю', ruPath(c)]);
        root.classList.add('acting');
        try {
          const params = args.params && typeof args.params === 'object' ? { ...args.params } : {};
          // Экспорт: файл скачивается в браузере (папка /exports/ в редакторе).
          if (c.id === 'file.exportMedia' || c.id === 'export.quick') {
            const p = String(params.path || '').split('/').pop();
            if (p) params.path = '/exports/' + p;
          }
          const r = await PC.exec(c.id, params);
          cardResult(d, true, '', !NOT_UNDOABLE.test(c.id));
          return short(r && typeof r === 'object' ? trimJson(r, 3000) : r);
        } catch (e) {
          cardResult(d, false, e.message);
          return { ok: false, error: e.message, params_doc: c.params ? clip(String(c.params), 800) : undefined };
        } finally {
          root.classList.remove('acting');
        }
      }
      case 'set_playhead': {
        const d = card(name, args);
        return attempt(d, async () => { const s = Math.max(0, Number(args.seconds) || 0); await PC.exec('playhead.set', { seconds: s }); return { ok: true, seconds: s }; });
      }
      case 'select_clips': {
        const d = card(name, args);
        return attempt(d, async () => {
          const ids = (Array.isArray(args.clips) ? args.clips : []).map(Number).filter(Number.isFinite);
          if (ids.length) await PC.exec('timeline.select', { clips: ids, add: false });
          else await PC.exec('edit.deselectAll');
          return { ok: true, selected: ids.length };
        });
      }
      case 'undo': {
        const n = Math.max(1, Math.min(20, parseInt(args.steps, 10) || 1));
        const d = card(name, { steps: n });
        try { for (let i = 0; i < n; i++) await PC.exec('edit.undo'); cardResult(d, true); return { ok: true }; } catch (e) { cardResult(d, false, e.message); return { ok: false, error: e.message }; }
      }
      default:
        return { ok: false, error: `Инструмента «${name}» нет. Доступны только: ${TOOL_NAMES.join(', ')}. Кликов по координатам нет: найди команду через find_commands и выполни её run_command.` };
    }
  }

  // Модель иногда пишет вызов инструмента текстом вместо tool_calls — подхватываем его.
  const TOOL_NAMES = ['find_commands', 'get_state', 'clip_details', 'list_captions', 'list_effects', 'look_at_screen', 'run_command', 'set_playhead', 'select_clips', 'undo'];
  function inlineCalls(text) {
    if (!text || !/[{[]/.test(text)) return [];
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return [];
    try {
      const o = JSON.parse(m[0]);
      const list = Array.isArray(o) ? o : [o];
      return list
        .filter((x) => x && TOOL_NAMES.includes(x.name))
        .map((x) => ({ function: { name: x.name, arguments: x.arguments || x.parameters || {} } }));
    } catch { return []; }
  }


  // ------------------------------------------------------------------ разговор с моделью
  // Память разговора. У модели ограниченный контекст (CTX токенов, сервер сообщает его при запуске);
  // если история не влезает, сервер модели молча отрезает её начало — вместе с задачей, и помощник
  // начинает ходить по кругу. Поэтому прошлые просьбы уходят сжато (просьба и итог, без шагов и
  // снимков), текущая — целиком; если и она не влезает, сначала сокращаются старые результаты шагов,
  // потом выпадают самые ранние шаги, но сама просьба остаётся всегда.
  let CTX = 32768;
  let turnStart = 0;
  const AUTO_STATE = /\n\n\[Состояние [^\]]*— автоматически\][\s\S]*$/;
  const AUTO_MSG = /^\[(Снимок экрана|Состояние)[^\]]*автоматически\]/;
  const plainText = (t) => String(t || '').replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '').replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<?function=[\w.-]+>[\s\S]*?(<\/function>|$)/g, '').replace(/<\/?tool_call>/g, '').trim();
  const sizeOf = (m) => String(m.content || '').length + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0) + (m.images ? m.images.length * 3500 : 0);
  function outgoing() {
    const start = Math.min(Math.max(0, turnStart), convo.length);
    const older = [];
    for (const m of convo.slice(0, start)) {
      if (m.role === 'tool') continue;
      if (m.role === 'user') {
        if (AUTO_MSG.test(String(m.content || ''))) continue;
        older.push({ role: 'user', content: clip(String(m.content || '').replace(AUTO_STATE, ''), 1500) });
      } else if (m.role === 'assistant') {
        const text = plainText(m.content);
        const names = [...new Set((m.tool_calls || []).map((c) => c.function && c.function.name).filter(Boolean))];
        const line = text ? clip(text, 1200) : (names.length ? '[Выполнено: ' + names.join(', ') + ']' : '');
        if (!line) continue;
        const last = older[older.length - 1];
        if (last && last.role === 'assistant') last.content = clip(last.content + '\n' + line, 2400);
        else older.push({ role: 'assistant', content: line });
      }
    }
    const recent = older.slice(-16);
    while (recent.length && recent[0].role !== 'user') recent.shift();
    const out = recent.concat(convo.slice(start).map((m) => ({ ...m })));
    // Только последний снимок экрана: картинки тяжёлые.
    let images = 0;
    for (let i = out.length - 1; i >= 0; i--) {
      if (!out[i].images) continue;
      if (images >= 1) delete out[i].images; else images += out[i].images.length;
    }
    const budget = Math.max(12000, Math.round(CTX * 2.6) - 22000);
    let total = out.reduce((n, m) => n + sizeOf(m), 0);
    let task = out.length - (convo.length - start); // где в out начинается текущая просьба
    // 1) прошлые просьбы, начиная с самых старых
    while (total > budget && task > 0) {
      total -= sizeOf(out.shift());
      task--;
      while (task > 0 && out[0].role !== 'user') { total -= sizeOf(out.shift()); task--; }
    }
    // 2) старые результаты шагов и устаревшие состояния текущей просьбы
    for (let i = task + 1; total > budget && i < out.length - 6; i++) {
      const m = out[i];
      if ((m.role === 'tool' || AUTO_MSG.test(String(m.content || ''))) && String(m.content || '').length > 400) {
        total -= sizeOf(m);
        m.content = clip(String(m.content), 300);
        delete m.images;
        total += sizeOf(m);
      }
    }
    // 3) самые ранние шаги текущей просьбы (целыми группами: ответ модели и результаты его шагов)
    let dropped = 0;
    while (total > budget && out.length - (task + 1) > 8) {
      let end = task + 2;
      while (end < out.length - 8 && out[end].role !== 'assistant') end++;
      const removed = out.splice(task + 1, end - (task + 1));
      if (!removed.length) break;
      dropped += removed.length;
      total -= removed.reduce((n, m) => n + sizeOf(m), 0);
    }
    if (dropped) {
      out.splice(task + 1, 0, { role: 'user', content: `[Ранние шаги этой просьбы (${dropped} сообщ.) убраны, чтобы уместиться в память модели. Что уже сделано — смотри по последнему состоянию.]` });
      if (out[task + 2] && out[task + 2].role === 'tool') out.splice(task + 2, 0, { role: 'assistant', content: '[продолжаю]' });
    }
    return out;
  }

  // Запрос к серверу помощника. Если сервер не принимает запрос со снимком экрана (nginx по
  // умолчанию берёт не больше 1 МБ и при большем просто обрывает соединение — браузер пишет
  // «Failed to fetch»), запрос повторяется без снимка, и дальше снимки не отправляются.
  const BODY_LIMIT = 900 * 1024;
  let imagesBlocked = false;
  const withoutImages = (payload) => ({ ...payload, messages: payload.messages.map((m) => { const { images, ...rest } = m; void images; return rest; }) });
  const hasImages = (payload) => payload.messages.some((m) => m.images && m.images.length);
  function tellImagesBlocked() {
    if (imagesBlocked) return;
    imagesBlocked = true;
    msg('note', 'Сервер не принял запрос со снимком экрана, поэтому помощник отвечает без него. ' +
      'Чтобы он видел экран, добавьте в nginx для api/assistant.php строку <code>client_max_body_size 20m;</code> (готовый блок — в nginx.conf.example).');
  }
  async function explainNoAnswer(seconds) {
    try {
      const r = await fetch(CFG.api, { credentials: 'same-origin', cache: 'no-store' });
      if (r.ok) {
        const when = seconds >= 1 ? ` через ${Math.round(seconds)} с` : ' сразу';
        const why = seconds >= 45
          ? 'Похоже, сервер не дождался модели: для api/assistant.php нужна строка fastcgi_read_timeout 200s; (и такой же таймаут у прокси перед сервером, если он есть).'
          : 'Обычно так бывает, когда запрос больше, чем разрешает сервер (client_max_body_size 20m; для api/assistant.php), или его блокирует защита сервера.';
        return `Сервер оборвал соединение${when} и ничего не ответил, хотя сам помощник доступен. ${why} Готовый блок — в nginx.conf.example.`;
      }
      return `Сервер помощника ответил «${r.status}». Проверьте, что PHP обрабатывает файлы в папке api/.`;
    } catch {
      return 'Нет связи с сервером помощника: страница не может достучаться до api/assistant.php. Проверьте подключение и обновите страницу.';
    }
  }
  async function postApi(payload) {
    const post = (p) => fetch(CFG.api, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
    if (imagesBlocked && hasImages(payload)) payload = withoutImages(payload);
    if (hasImages(payload) && JSON.stringify(payload).length > BODY_LIMIT) payload = withoutImages(payload);
    let r;
    const t0 = performance.now();
    const took = () => (performance.now() - t0) / 1000;
    try {
      r = await post(payload);
    } catch (e) {
      console.warn('AI Видео: запрос к помощнику оборвался', e);
      if (!hasImages(payload)) throw new Error(await explainNoAnswer(took()));
      try { r = await post(withoutImages(payload)); } catch { throw new Error(await explainNoAnswer(took())); }
      tellImagesBlocked();
      return r;
    }
    if (r.status === 413 && hasImages(payload)) {
      r = await post(withoutImages(payload));
      tellImagesBlocked();
    }
    return r;
  }
  async function readAnswer(r) {
    let j;
    try { j = await r.json(); } catch {
      if (r.status === 413) throw new Error('Сервер не принял такой большой запрос (413). Нужна строка client_max_body_size 20m; в nginx — см. nginx.conf.example.');
      if (r.status === 502 || r.status === 504) throw new Error(`Сервер не дождался ответа модели (${r.status}). Нужна строка fastcgi_read_timeout 200s; в nginx — см. nginx.conf.example.`);
      throw new Error(`Сервер помощника ответил не JSON (HTTP ${r.status}). Проверьте, что PHP работает в папке api/.`);
    }
    return j;
  }
  // Шлюз модели не передаёт инструменты штатно (вызовы приходят текстом) — запоминаем это.
  let textTools = store.get('textTools', false);
  async function ask() {
    const r = await postApi({ mode, messages: outgoing(), textTools });
    const j = await readAnswer(r);
    if (j && j.ok && j.textTools && !textTools) { textTools = true; store.set('textTools', true); }
    if (!j.ok) {
      const e = new Error(j.error || 'Ошибка помощника');
      e.noVision = !!j.noVision;
      throw e;
    }
    return j;
  }

  async function send(fromBar) {
    if (busy) { stopRequested = true; return; }
    const field = typeof fromBar === 'string' ? null : input;
    const text = (typeof fromBar === 'string' ? fromBar : input.value).trim();
    if (!text) return;
    if (field) { field.value = ''; autosize(); }
    setBusy(true);
    stopRequested = false;
    allowAllThisTurn = false;
    autoAllowNoted = false;
    seen = new Map();
    msg('user', esc(text));
    try {
      let state = null;
      let image = null;
      if (PC.ready()) {
        state = await snapshot().catch((e) => ({ error: e.message }));
        if (attachScreen) image = await screenshot();
      }
      turnStart = convo.length;
      convo.push({
        role: 'user',
        content: MODE_TAG[mode] + '\n' + text + '\n\n[Состояние редактора — автоматически]\n' + clip(JSON.stringify(state ?? { note: 'Редактор ещё загружается' }), 4000),
        ...(image ? { images: [image] } : {}),
      });
      await runSteps();
    } catch (e) {
      turnFailed(e);
    } finally {
      turnDone();
    }
  }
  // Продолжить ту же просьбу после остановки по числу шагов (без нового сообщения).
  async function continueTurn() {
    if (busy) return;
    setBusy(true);
    stopRequested = false;
    try { await runSteps(); } catch (e) { turnFailed(e); } finally { turnDone(); }
  }
  function turnFailed(e) {
    typing(false);
    if (e.noVision) setEye(false);
    msg('err', esc(e.message || String(e)));
  }
  function turnDone() {
    typing(false);
    setBusy(false);
    root.classList.remove('acting');
    updateBarAnswer();
  }
  // Повторы считаются за всю просьбу, в том числе после «Продолжить».
  let seen = new Map();
  async function runSteps() {
    const limit = agentSteps();
    for (let step = 0; ; step++) {
      if (stopRequested) { msg('bot', 'Остановлено.'); break; }
      if (step >= limit) {
        const d = msg('note', `Сделал ${limit} шагов подряд и остановился (так задано: «Настройки» внизу панели). `);
        const b = document.createElement('button');
        b.className = 'st-mini';
        b.textContent = 'Продолжить';
        b.onclick = () => { b.disabled = true; continueTurn(); };
        d.appendChild(b);
        break;
      }
      typing(true);
      const j = await ask();
      typing(false);
        const m = j.message || {};
        let calls = Array.isArray(m.tool_calls) ? m.tool_calls : [];
        let content = (m.content || '').replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '').replace(/<think>[\s\S]*?<\/think>/g, '')
          .replace(/<?function=[\w.-]+>[\s\S]*?(<\/function>|$)/g, '').replace(/<\/?tool_call>/g, '').trim();
        if (!calls.length) {
          calls = inlineCalls(content);
          if (calls.length) content = content.replace(/\{[\s\S]*\}/, '').trim();
        }
        // «Сделай», а модель всё равно ответила как в «Совете» — одна попытка её поправить.
        if (mode === 'act' && !calls.length && step === 0 && /режим\S*\s*«?Совет/i.test(content)) {
          convo.push({ role: 'assistant', content: m.content || '' });
          convo.push({ role: 'user', content: MODE_NOTE.act + ' Выполни просьбу сейчас.' });
          continue;
        }
        convo.push({ role: 'assistant', content: m.content || '', ...(calls.length ? { tool_calls: calls } : {}) });
        if (content) msg('bot', format(content));
        if (!calls.length) break;
        let pendingImage = null;
        let acted = false;
        for (const c of calls) {
          if (stopRequested) break;
          const fname = c.function && c.function.name;
          let a = (c.function && c.function.arguments) || {};
          if (typeof a === 'string') { try { a = JSON.parse(a || '{}'); } catch { a = {}; } }
          const sig = fname + ' ' + JSON.stringify(a || {});
          const times = (seen.get(sig) || 0) + 1;
          seen.set(sig, times);
          let result;
          try { result = await runTool(fname, a || {}); } catch (e) { result = { ok: false, error: e.message || String(e) }; }
          if (result && result.__image) { pendingImage = result.__image; delete result.__image; }
          const reading = READ_TOOLS.has(fname);
          if (!reading) acted = true;
          // Одно и то же действие по кругу — подсказываем модели остановиться и проверить результат.
          if (times >= (reading ? 4 : 3)) {
            const warning = `Ты уже ${times} раз(а) вызывал ${fname} с теми же параметрами. Не повторяй. `
              + (reading ? 'Всё нужное уже получено — действуй или заверши ответ.' : 'Проверь результат (get_state или look_at_screen) и переходи к следующей части задачи; если задача выполнена — заверши её коротким итогом.');
            result = (result && typeof result === 'object' && !Array.isArray(result)) ? { ...result, warning } : { result, warning };
          }
          convo.push({ role: 'tool', tool_name: fname, content: clip(JSON.stringify(result ?? { ok: true }), 6000) });
        }
        // После действий — свежее состояние документа (и снимок, если помощнику можно смотреть
        // на экран): модель видит, что уже сделано, и не рисует одно и то же заново.
        if (acted && !stopRequested && PC.ready()) {
          const st = await snapshot().catch(() => null);
          if (!pendingImage && attachScreen && store.get('agentLook', true)) pendingImage = await screenshot().catch(() => null);
          convo.push({
            role: 'user',
            content: '[Состояние после этих шагов — автоматически]\n' + clip(JSON.stringify(st ?? {}), 3500) + (pendingImage ? '\n(снимок экрана приложен)' : ''),
            ...(pendingImage ? { images: [pendingImage] } : {}),
          });
        } else if (pendingImage) {
          convo.push({ role: 'user', content: '[Снимок экрана после действий — прислан автоматически]', images: [pendingImage] });
        }
    }
  }

  // ------------------------------------------------------------------ быстрая строка
  // Ctrl+Shift+Пробел: поле внизу над холстом. Ответ всплывает над ним; вся история — в панели.
  const bar = $('bar');
  const barInput = $('barInput');
  const barAnswer = $('barAnswer');
  function setBar(open) {
    root.classList.toggle('bar-open', open);
    if (open) { setTimeout(() => barInput.focus(), 30); updateBarAnswer(); }
  }
  function updateBarAnswer() {
    if (!root.classList.contains('bar-open')) return;
    if (busy) { barAnswer.innerHTML = '<div class="st-typing"><i></i><i></i><i></i></div>'; barAnswer.hidden = false; return; }
    const last = [...log.querySelectorAll('.st-msg.bot, .st-msg.err')].pop();
    if (!last || !barSent) { barAnswer.hidden = true; return; }
    barAnswer.hidden = false;
    barAnswer.innerHTML = `<div class="st-bar-text ${last.classList.contains('err') ? 'err' : ''}">${last.innerHTML}</div><button class="st-link" data-a="panel">Открыть в панели</button>`;
    barAnswer.querySelector('[data-a="panel"]').onclick = () => { setBar(false); setOpen(true); };
  }
  let barSent = false;
  async function sendFromBar() {
    const text = barInput.value.trim();
    if (!text || busy) return;
    barInput.value = '';
    barSent = true;
    const done = send(text);
    updateBarAnswer();
    await done;
    updateBarAnswer();
  }
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && e.shiftKey && (e.ctrlKey || e.metaKey) && !e.altKey) {
      e.preventDefault();
      e.stopImmediatePropagation();
      setBar(!root.classList.contains('bar-open'));
    }
  }, true);

  // ------------------------------------------------------------------ сообщения
  function setBadge(on) { root.classList.toggle('has-hints', on); }
  function toast(text, error, ms) {
    let t = root.querySelector('.st-toast');
    if (!t) { t = document.createElement('div'); t.className = 'st-toast'; root.appendChild(t); }
    t.textContent = text;
    t.classList.toggle('err', !!error);
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), ms || 3200);
  }
  // Файлы, брошенные на страницу (и на панель тоже), редактор принимает сам: проект открывается,
  // медиа ложатся в панель «Проект».

  // ------------------------------------------------------------------ файлы на сервере
  const fmtSize = (n) => (n < 1024 ? n + ' Б' : n < 1048576 ? Math.round(n / 1024) + ' КБ' : (n / 1048576).toFixed(1).replace('.', ',') + ' МБ');
  const fmtDate = (t) => {
    if (!t) return '';
    const d = new Date(t * 1000), now = new Date();
    const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === now.toDateString()) return 'сегодня, ' + time;
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' }) + ', ' + time;
  };
  // Проект: .fcproj (монтаж, титры, субтитры, эффекты; медиа он только называет — они лежат рядом в «Моих проектах»).
  const PROJECT_EXT = /\.fcproj$/i;
  const VIDEO_EXT = /\.(mp4|m4v|mov|3gp|mkv|webm|avi|mxf|mts|m2ts|ts|mpg|mpeg)$/i;
  const AUDIO_EXT = /\.(wav|wave|bwf|aif|aiff|mp3|m4a|aac|flac|ogg|opus)$/i;
  const IMAGE_EXT = /\.(png|jpe?g|gif|webp|tiff?|bmp)$/i;
  const SUBS_EXT = /\.(srt|vtt)$/i;
  const ANY_EXT = /\.(fcproj|mp4|m4v|mov|3gp|mkv|webm|avi|mxf|mts|m2ts|ts|mpg|mpeg|wav|wave|bwf|aif|aiff|mp3|m4a|aac|flac|ogg|opus|png|jpe?g|gif|webp|tiff?|bmp|srt|vtt)$/i;
  const NATIVE = '.fcproj';
  const ACCEPT = '.fcproj,.mp4,.m4v,.mov,.3gp,.mkv,.webm,.avi,.mxf,.mts,.m2ts,.ts,.mpg,.mpeg,.wav,.bwf,.aif,.aiff,.mp3,.m4a,.aac,.flac,.ogg,.opus,.png,.jpg,.jpeg,.gif,.webp,.tif,.tiff,.bmp,.srt,.vtt';
  const kindOf = (n) => (PROJECT_EXT.test(n) ? 'проект' : VIDEO_EXT.test(n) ? 'видео' : AUDIO_EXT.test(n) ? 'звук' : IMAGE_EXT.test(n) ? 'картинка' : SUBS_EXT.test(n) ? 'субтитры' : 'файл');
  // Имя проекта на сервере: без запрещённых символов, не длиннее 100, с .fcproj.
  const engineName = (n) => {
    const s = String(n || '').replace(PROJECT_EXT, '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().replace(/^\.+/, '');
    return (s ? [...s].slice(0, 100).join('') : 'Без названия') + NATIVE;
  };
  const baseName = (p) => String(p || '').split('/').pop();
  // Новый пустой проект (с вопросом, если в открытом есть несохранённые изменения).
  async function newProject() {
    try { const d = await project(); if (d.dirty && !window.confirm('В открытом проекте есть несохранённые изменения. Начать новый проект без них?')) return false; } catch { /* ниже */ }
    await PC.exec('file.newProject', { name: 'Без названия' });
    return true;
  }

  // Окно с одним полем: имя файла.
  function askName(title, value, note) {
    return new Promise((resolve) => {
      const box = $('ask');
      $('askTitle').textContent = title;
      $('askNote').textContent = note || '';
      const field = $('askInput');
      field.value = value || '';
      box.hidden = false;
      setTimeout(() => { field.focus(); const dot = field.value.lastIndexOf('.'); field.setSelectionRange(0, dot > 0 ? dot : field.value.length); }, 30);
      const done = (v) => { box.hidden = true; form.onsubmit = null; $('askCancel').onclick = null; box.onkeydown = null; resolve(v); };
      const form = box.querySelector('form');
      form.onsubmit = (e) => { e.preventDefault(); done(field.value.trim() || null); };
      $('askCancel').onclick = () => done(null);
      box.onkeydown = (e) => { if (e.key === 'Escape') { e.preventDefault(); done(null); } };
    });
  }

  // Копия проекта в браузере, если сохранить на сервер не вышло (нет связи, сервер не принял файл).
  const Recovery = (() => {
    const open = () => new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('нет IndexedDB')); return; }
      const r = indexedDB.open('aipremiere', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('recovery');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const run = async (mode, fn) => {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('recovery', mode);
        const req = fn(tx.objectStore('recovery'));
        tx.oncomplete = () => { db.close(); resolve(req && req.result); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      });
    };
    return {
      put: (v) => run('readwrite', (s) => s.put(v, 'last')).catch(() => {}),
      get: () => run('readonly', (s) => s.get('last')).catch(() => null),
      clear: () => run('readwrite', (s) => s.delete('last')).catch(() => {}),
    };
  })();

  // Медиа, на которые ссылается проект: пути /files/<имя> в его JSON.
  function mediaPaths(text) {
    const out = new Set();
    const re = /"(\/files\/(?:[^"\\]|\\.){1,400})"/g;
    let m;
    while ((m = re.exec(String(text))) && out.size < 2000) {
      try { out.add(JSON.parse('"' + m[1] + '"')); } catch { /* странная строка — пропускаем */ }
    }
    return [...out];
  }

  const Files = (() => {
    let list = [];
    let server = null;        // имя открытого проекта на сервере (с расширением), если он оттуда
    const known = new Set();  // пути проектов в редакторе (/projects/<имя>), которые лежат на сервере
    let dirty = false;
    let quietNext = false;    // автосохранение
    let saving = false;
    let limit = 0;
    const api = (q) => CFG.files + (q ? '?' + q : '');
    async function json(r) {
      let j = null;
      try { j = await r.json(); } catch { /* ниже */ }
      if (!j) throw new Error(r.status === 413 ? 'Файл слишком большой для сервера: увеличьте client_max_body_size в nginx, post_max_size и upload_max_filesize в PHP и AI_PREMIERE_MAX_MB (см. README.ru.md).' : `Сервер ответил ${r.status}: проверьте, что PHP обрабатывает api/files.php.`);
      if (!j.ok) { const e = new Error(j.error || 'Ошибка сервера'); e.exists = !!j.exists; e.login = !!j.login; throw e; }
      return j;
    }
    async function refresh() {
      const j = await json(await fetch(api(''), { credentials: 'same-origin', cache: 'no-store' }));
      list = Array.isArray(j.files) ? j.files : [];
      limit = Number(j.limit) || 0;
      $('filesWho').textContent = j.user && j.user !== 'local' ? 'на сервере · пользователь ' + j.user : 'на сервере';
      return list;
    }
    function render() {
      const q = norm($('filesSearch').value).trim();
      const rows = list.filter((f) => !q || norm(f.name).includes(q));
      const box = $('filesList');
      if (!list.length) { box.innerHTML = '<p class="st-files-empty">Здесь будут ваши проекты и медиа. Откройте видео кнопкой «С компьютера…» (или перетащите файлы в окно), смонтируйте и нажмите «Сохранить» или Ctrl+S: проект .fcproj ляжет сюда вместе со всеми видео, звуком и картинками, которые в нём есть.</p>'; return; }
      if (!rows.length) { box.innerHTML = '<p class="st-files-empty">Ничего не найдено.</p>'; return; }
      box.innerHTML = rows.map((f, i) => `<div class="st-file" data-i="${i}" tabindex="0">
          <span class="st-file-icon">${ICON.file}</span>
          <span class="st-file-name">${esc(f.name)}</span>
          <span class="st-file-meta">${kindOf(f.name)} · ${esc(fmtDate(f.modified))} · ${esc(fmtSize(f.size))}</span>
          <span class="st-file-acts"><button class="st-link" data-a="rename">Переименовать</button><button class="st-link danger" data-a="delete">Удалить</button></span>
        </div>`).join('');
      box.querySelectorAll('.st-file').forEach((row) => {
        const f = rows[+row.dataset.i];
        row.onclick = (e) => { if (!e.target.closest('button')) load(f.name); };
        row.onkeydown = (e) => { if (e.key === 'Enter') load(f.name); };
        row.querySelector('[data-a="rename"]').onclick = () => rename(f.name);
        row.querySelector('[data-a="delete"]').onclick = () => remove(f.name);
      });
    }
    function updateFoot() {
      $('filesCurrent').textContent = server ? `Открыт «${server}»` + (dirty ? ' · есть изменения' : '') : (dirty ? 'Проект ещё не сохранён на сервере' : '');
    }
    async function show(on = true) {
      $('files').hidden = !on;
      if (!on) return;
      $('filesList').innerHTML = '<p class="st-files-empty">Загружаю список…</p>';
      updateFoot();
      try { await refresh(); render(); } catch (e) { $('filesList').innerHTML = `<p class="st-files-empty err">${esc(e.message)}</p>`; }
      setTimeout(() => $('filesSearch').focus(), 30);
    }
    const download = async (name) => {
      const r = await fetch(api('action=load&name=' + encodeURIComponent(name)), { credentials: 'same-origin', cache: 'no-store' });
      if (!r.ok) await json(r);
      return r.blob();
    };
    // Проект открывается вместо текущего, а перед этим его медиа с сервера встают на свои места;
    // видео, звук, картинки и субтитры ложатся в панель «Проект» открытого проекта.
    async function load(name) {
      try {
        if (PROJECT_EXT.test(name)) {
          const d = await project().catch(() => null);
          if (d && d.dirty && !window.confirm('В открытом проекте есть несохранённые изменения. Открыть «' + name + '» без них?')) return;
        }
        toast('Открываю «' + name + '»…', false, 60000);
        const blob = await download(name);
        if (!PROJECT_EXT.test(name)) {
          const r = await VC().open(name, blob);
          show(false);
          const errors = (r && r.errors) || [];
          if (errors.length) toast('«' + name + '» не открылся: ' + errors.join('; '), true);
          else toast(`«${name}» добавлен в панель «Проект». Перетащите его на таймлайн или попросите помощника.`);
          return;
        }
        if (!list.length) await refresh().catch(() => {});
        const onServer = new Map(list.map((f) => [f.name, f]));
        const paths = mediaPaths(await blob.text()).filter((p) => onServer.has(baseName(p)));
        let n = 0;
        for (const p of paths) {
          n++;
          toast(`Загружаю медиа проекта: «${baseName(p)}» (${n} из ${paths.length})…`, false, 600000);
          try { VC().putMedia(p, await download(baseName(p))); } catch (e) { console.warn('AI Видео: медиа ' + p, e); }
        }
        await VC().open(name, blob);
        show(false);
        known.add('/projects/' + name);
        server = name;
        const st = await project().catch(() => null);
        dirty = !!(st && st.dirty);
        toast('Открыт «' + name + '»' + (paths.length ? ` (медиа: ${paths.length})` : '') + '.');
      } catch (e) { toast('Не удалось открыть: ' + e.message, true); }
    }
    async function upload(name, body, overwrite) {
      const r = await fetch(api('action=save&name=' + encodeURIComponent(name) + (overwrite ? '&overwrite=1' : '')), {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream' }, body,
      });
      return json(r);
    }
    // Медиа проекта, которых ещё нет в «Моих проектах» (или там другой файл того же имени и размера), загружаются туда же.
    async function uploadMedia(projectBytes) {
      let text = '';
      try { text = new TextDecoder().decode(projectBytes); } catch { return 0; }
      await refresh().catch(() => {});
      const have = new Map(list.map((f) => [f.name, f.size]));
      const todo = [];
      for (const p of mediaPaths(text)) {
        const name = baseName(p);
        if (!ANY_EXT.test(name) || PROJECT_EXT.test(name)) continue;
        const blob = VC().mediaBlob(p);
        if (!blob) continue;
        if (have.get(name) === blob.size) continue;
        todo.push([name, blob, have.has(name)]);
      }
      let done = 0;
      const failed = [];
      for (const [name, blob, exists] of todo) {
        if (limit && blob.size > limit) { failed.push(`${name} (${fmtSize(blob.size)} — больше предела сервера ${fmtSize(limit)})`); continue; }
        toast(`Загружаю на сервер медиа проекта: «${name}», ${fmtSize(blob.size)} (${done + 1} из ${todo.length})…`, false, 3600000);
        try { await upload(name, blob, exists); done++; } catch (e) { failed.push(`${name} (${e.message})`); }
      }
      if (failed.length) msg('note', 'Не все медиа проекта легли на сервер: ' + esc(failed.join('; ')) + '. Проект сохранён; эти файлы откроются, пока они есть в этом браузере.');
      return done;
    }
    // Сохранение из редактора (Ctrl+S, Файл › Сохранить, «Сохранить как»): проект приходит сюда
    // под тем именем, которое дал ему редактор.
    async function onSave(detail) {
      const quiet = quietNext;
      quietNext = false;
      const bytes = detail.bytes;
      const path = String(detail.path || '');
      const name = engineName(detail.name || baseName(path));
      try {
        saving = true;
        let overwrite = known.has(path) || name === server;
        if (!overwrite) {
          await refresh().catch(() => {});
          if (list.some((f) => f.name === name) && !window.confirm(`Проект «${name}» уже есть в «Моих проектах». Заменить его?`)) { dirty = true; return; }
          overwrite = true;
        }
        if (limit && bytes.length > limit) throw new Error(`проект (${fmtSize(bytes.length)}) больше предела сервера ${fmtSize(limit)}`);
        const r = await upload(name, bytes, overwrite);
        server = r.name;
        known.add(path);
        Recovery.clear();
        const media = await uploadMedia(bytes);
        if (!quiet || media) toast('Сохранено в «Мои проекты»: «' + r.name + '»' + (media ? `, медиа: ${media}` : ''));
        if (!$('files').hidden) { await refresh().catch(() => {}); render(); updateFoot(); }
      } catch (e) {
        Recovery.put({ name, data: bytes, time: Date.now() });
        if (e.login) toast('Войдите в систему, чтобы сохранять проекты на сервере. Копия осталась в браузере.', true);
        else toast((quiet ? 'Автосохранение не удалось: ' : 'Не удалось сохранить: ') + e.message + '. Копия осталась в браузере.', true);
      } finally { saving = false; }
    }
    // Сохранить под новым именем: проект ложится в /projects/<имя>.fcproj редактора, а оттуда — на сервер.
    async function saveAs(suggest) {
      const typed = await askName('Сохранить в «Мои проекты»', engineName(suggest), 'Проект и все его видео, звук и картинки лягут в «Мои проекты» на сервере.');
      if (!typed) return;
      await PC.exec('file.saveAs', { path: '/projects/' + engineName(typed) });
    }
    async function save(asNew) {
      if (!PC.ready()) return;
      try {
        const d = await project();
        if (!asNew && d.path && known.has(d.path)) { await PC.exec('file.save'); return; }
        await saveAs(d.path ? baseName(d.path) : (d.name || 'Без названия'));
      } catch (e) { toast('Не удалось сохранить: ' + e.message, true); }
    }
    async function rename(name) {
      const to0 = await askName('Переименовать', name);
      if (!to0 || to0 === name) return;
      const ext = (name.match(ANY_EXT) || [''])[0];
      const to = ANY_EXT.test(to0) ? to0 : to0 + ext;
      try {
        await json(await fetch(api('action=rename'), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, to }) }));
        if (server === name) { server = null; known.clear(); }
        if (!PROJECT_EXT.test(name)) msg('note', `Медиа «${esc(name)}» переименовано. Проекты, где оно было под старым именем, при открытии его не найдут: их можно связать заново (Файл › Связать медиа) или вернуть старое имя.`);
        await refresh(); render(); updateFoot();
      } catch (e) { toast('Не удалось переименовать: ' + e.message, true); }
    }
    async function remove(name) {
      if (!window.confirm(`Удалить «${name}»? Файл уйдёт в корзину на сервере.`)) return;
      try {
        await json(await fetch(api('action=delete'), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }));
        if (server === name) server = null;
        await refresh(); render();
      } catch (e) { toast('Не удалось удалить: ' + e.message, true); }
    }
    // Файлы с компьютера: проект открывается, медиа ложатся в панель «Проект» (без копирования в
    // память: браузер читает их с диска). На сервер медиа уходят вместе с проектом при сохранении.
    function pickLocal(mediaOnly) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = mediaOnly ? ACCEPT.replace('.fcproj,', '') : ACCEPT;
      input.multiple = true;
      input.onchange = async () => {
        const files = [...(input.files || [])];
        show(false);
        for (const f of files) {
          try {
            toast('Открываю «' + f.name + '»…', false, 60000);
            const r = await VC().open(f.name, f);
            if (PROJECT_EXT.test(f.name)) { server = null; toast('Открыт «' + f.name + '». Его медиа добавьте с компьютера, затем сохраните проект (Ctrl+S).'); continue; }
            const errors = (r && r.errors) || [];
            if (errors.length) toast('«' + f.name + '» не открылся: ' + errors.join('; '), true);
            else toast('«' + f.name + '» добавлен в панель «Проект».');
          } catch (e) { toast('Не удалось открыть ' + f.name + ': ' + e.message, true); }
        }
      };
      input.click();
    }
    async function offerRecovery() {
      const r = await Recovery.get();
      if (!r || !r.data) return;
      const when = new Date(r.time).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      const d = msg('note', `Проект «${esc(r.name)}» от ${esc(when)} не удалось сохранить на сервер — его копия осталась в браузере. ` +
        '<span class="st-row"><button class="st-mini" data-a="open">Открыть копию</button><button class="st-mini danger" data-a="drop">Удалить копию</button></span>');
      d.querySelector('[data-a="open"]').onclick = async () => {
        try { await VC().open(r.name, r.data); server = null; d.remove(); toast('Копия открыта. Сохраните её (Ctrl+S).'); }
        catch (e) { toast('Не удалось открыть копию: ' + e.message, true); }
      };
      d.querySelector('[data-a="drop"]').onclick = () => { Recovery.clear(); d.remove(); };
      setOpen(true);
    }
    // Раз в autosaveSeconds: проект, который уже лежит на сервере, сохраняется туда сам.
    async function tick() {
      for (;;) {
        await sleep(Math.max(30, CFG.autosaveSeconds || 120) * 1000);
        if (!CFG.autosaveSeconds || document.hidden || !PC.ready() || saving || !server || !dirty) continue;
        const d = await project().catch(() => null);
        if (!d || !d.path || !known.has(d.path)) continue;
        const ui = await PC.call('ui.inspect').catch(() => null);
        if (ui && ui.playback && ui.playback.playing) continue;
        quietNext = true;
        await PC.exec('file.save').catch(() => { quietNext = false; });
      }
    }
    function start() {
      VC().takesSaves = true;
      window.addEventListener('aipremiere:save', (e) => onSave(e.detail || {}));
      window.addEventListener('aipremiere:saveas', (e) => { saveAs((e.detail && e.detail.name) || 'Без названия').catch((err) => toast('Не удалось сохранить: ' + err.message, true)); });
      window.addEventListener('aipremiere:dirty', (e) => { dirty = !!(e.detail && e.detail.dirty); if (!$('files').hidden) updateFoot(); });
      $('filesBtn').onclick = () => show(true);
      $('filesClose').onclick = () => show(false);
      $('files').addEventListener('pointerdown', (e) => { if (e.target === $('files')) show(false); });
      $('files').addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('ask').hidden) { e.preventDefault(); show(false); } });
      $('filesSearch').addEventListener('input', render);
      $('filesNew').onclick = async () => { try { if (await newProject()) { server = null; show(false); } } catch (e) { toast(e.message, true); } };
      $('filesUpload').onclick = () => pickLocal(false);
      $('filesSave').onclick = () => save(false);
      $('filesSaveAs').onclick = () => save(true);
      // Браузер не должен предлагать «Сохранить страницу как…».
      window.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 's' || e.key === 'S' || e.code === 'KeyS')) e.preventDefault(); }, true);
      offerRecovery();
      tick();
      if (CFG.filesOnStart) refresh().then((l) => { if (l.length) show(true); }).catch(() => {});
    }
    return { start, show, save, pickLocal, current: () => server, forget: () => { server = null; }, isServer: (p) => known.has(p) };
  })();

  // ------------------------------------------------------------------ шрифты
  // Открытые шрифты для титров и субтитров (fonts/manifest.json): Liberation Sans, Serif и Mono
  // (по метрикам как Arial, Times New Roman и Courier New), Carlito (как Calibri), Caladea (как Cambria).
  // Кириллицу знают все. Загружаются в фоне после запуска, в списке шрифтов титров появляются сами.
  const Fonts = (() => {
    let loaded = 0;
    async function start() {
      let m = null;
      try { m = await (await fetch(CFG.fonts, { cache: 'no-cache' })).json(); } catch { return 0; }
      for (const f of (m && m.fonts) || []) {
        try {
          const r = await fetch('fonts/' + encodeURIComponent(f.file));
          if (!r.ok) continue;
          const res = await VC().addFont(f.file, new Uint8Array(await r.arrayBuffer()));
          if (res && res.faces) loaded += res.faces;
        } catch (e) { console.warn('AI Видео: шрифт ' + f.file, e); }
      }
      return loaded;
    }
    return { start, faces: () => loaded };
  })();

  // ------------------------------------------------------------------ быстрые задачи
  // Открытая последовательность и клипы, на которые действует задача: выделенные, а если ничего не
  // выделено — все клипы нужных дорожек.
  async function workSequence() {
    const q = await sequence();
    if (!q) throw new Error('Последовательность не открыта. Откройте видео и перетащите его на таймлайн (или «Новая последовательность из клипа»).');
    return q;
  }
  const allClips = (tracks) => tracks.flatMap((t) => t.items || []);
  function pickClips(q, which) {
    const sel = new Set(q.selection || []);
    const tracks = which === 'audio' ? (q.audio || []) : which === 'video' ? (q.video || []) : [...(q.video || []), ...(q.audio || [])];
    const all = allClips(tracks);
    const chosen = all.filter((c) => sel.has(c.clip));
    return chosen.length ? chosen : all;
  }
  let undoSteps = 0;
  const run = async (id, params) => { const r = await PC.exec(id, params || {}); undoSteps++; return r; };
  // Переходы на стыках соседних клипов одной дорожки (и в начале/конце, если edges).
  async function transitionsOn(tracks, video, frames) {
    let n = 0;
    for (const t of tracks) {
      const items = [...(t.items || [])].sort((a, b) => a.start - b.start);
      const has = (from, to) => (t.transitions || []).some((x) => x.from === from && x.to === to);
      for (let i = 0; i + 1 < items.length; i++) {
        const a = items[i], b = items[i + 1];
        if (Math.abs(a.end - b.start) > TPS / 1000 || has(a.clip, b.clip)) continue;
        try {
          await run(video ? 'sequence.applyVideoTransition' : 'sequence.applyAudioTransition',
            { clip: a.clip, edge: 'out', effect: video ? 'cross_dissolve' : 'constant_power', frames });
          n++;
        } catch (e) { console.warn('AI Видео: переход', e); }
      }
    }
    return n;
  }
  const exportName = async (ext) => { const p = await project(); return '/exports/' + engineName(p.name).replace(PROJECT_EXT, ext); };
  async function exportVideo(params, what) {
    const q = await workSequence();
    await PC.exec('file.exportMedia', Object.assign({ path: await exportName('.mp4'), format: 'h264', sequence: q.id }, params));
    return `${what}: экспорт идёт (ход — в шапке редактора), готовый файл скачается в браузере.`;
  }

  const TASKS = [
    ['Начало', [
      ['Открыть видео…', 'MP4, MOV, MKV, WebM, звук, картинки, SRT с компьютера', async () => { Files.pickLocal(true); return 'skip'; }],
      ['Последовательность из клипа', 'По размеру и частоте кадров выделенного в «Проекте» видео', async () => {
        const st = await PC.exec('state.inspect');
        let items = (st && st.project_selection) || [];
        if (!items.length) {
          const vids = projectItems(await project()).filter((i) => i.type === 'Movie');
          if (!vids.length) throw new Error('В проекте нет видео. Сначала откройте его («Открыть видео…»).');
          items = [vids[0].item];
        }
        await run('file.newSequenceFromClip', { items });
      }],
      ['Вертикальное видео 9:16', 'Новая последовательность 1080×1920, 30 к/с', async () => { await run('file.newSequence', { name: 'Вертикальное видео', width: 1080, height: 1920, fps: 30 }); }],
      ['Квадрат 1:1', 'Новая последовательность 1080×1080, 30 к/с', async () => { await run('file.newSequence', { name: 'Квадрат', width: 1080, height: 1080, fps: 30 }); }],
    ]],
    ['Монтаж', [
      ['Плавные переходы между клипами', 'Растворение 0,5 с на стыках видео и звука', async () => {
        const q = await workSequence();
        const n = (await transitionsOn(q.video || [], true, 15)) + (await transitionsOn(q.audio || [], false, 15));
        if (!n) throw new Error('Стыков без переходов не нашлось: клипы должны стоять вплотную друг к другу.');
        return `Переходов поставлено: ${n}.`;
      }],
      ['Плавное начало и конец', 'Из чёрного в начале и в чёрное в конце', async () => {
        const q = await workSequence();
        const v1 = [...((q.video || [])[0] || {}).items || []].sort((a, b) => a.start - b.start);
        if (!v1.length) throw new Error('На дорожке V1 нет клипов.');
        await run('sequence.applyVideoTransition', { clip: v1[0].clip, edge: 'in', effect: 'dip_to_black', frames: 20 });
        await run('sequence.applyVideoTransition', { clip: v1[v1.length - 1].clip, edge: 'out', effect: 'dip_to_black', frames: 20 });
      }],
      ['Разрезать здесь', 'Склейка на всех дорожках в точке указателя', async () => { await workSequence(); await run('sequence.addEditAllTracks', {}); }],
      ['Маркер здесь', 'В точке указателя', async () => { await workSequence(); await run('markers.add', {}); }],
    ]],
    ['Текст', [
      ['Титр в начале', 'Название ролика на 3 секунды', async () => {
        const q = await workSequence();
        const text = await askName('Текст титра', 'Название ролика', 'Титр встанет в начало ролика на 3 секунды над видео.');
        if (!text) return 'skip';
        await run('graphics.newText', { text, time: 0, seconds: 3, size: Math.round(((q.settings && q.settings.height) || 1080) / 10) });
      }],
      ['Субтитр здесь', 'Новый субтитр в точке указателя, 3 с', async () => {
        const q = await workSequence();
        const text = await askName('Текст субтитра', '', 'Субтитр встанет в точку указателя на 3 секунды.');
        if (!text) return 'skip';
        const caps = await captionTracks();
        if (!(caps.tracks || []).length) await run('captions.newTrack', { format: 'Subtitle', name: 'Субтитры', language: 'ru' });
        await run('captions.add', { text, time: q.playhead || 0, durationSeconds: 3 });
      }],
      ['Скачать субтитры SRT', 'Первая дорожка субтитров', async () => {
        const caps = await captionTracks();
        if (!(caps.tracks || []).length) throw new Error('В последовательности нет субтитров.');
        await PC.exec('captions.export', { path: await exportName('.srt'), format: 'srt', track: caps.tracks[0].id });
        return 'Субтитры скачиваются в браузере.';
      }],
    ]],
    ['Звук', [
      ['Выровнять звук', 'Голос — к единой громкости (−16 LUFS)', async () => {
        const q = await workSequence();
        const clips = pickClips(q, 'audio').map((c) => c.clip);
        if (!clips.length) throw new Error('На звуковых дорожках нет клипов.');
        await run('essentialSound.setType', { clips, type: 'dialogue' });
        await run('essentialSound.autoMatch', { clips, target: -16 });
      }],
      ['Приглушить музыку под голосом', 'Ключевые кадры громкости музыки там, где говорят', async () => {
        const q = await workSequence();
        const clips = pickClips(q, 'audio').map((c) => c.clip);
        if (!clips.length) throw new Error('Выделите клипы с музыкой.');
        await run('essentialSound.setType', { clips, type: 'music' });
        await run('essentialSound.generateDucking', { clips });
        return 'Готово. Музыку надо выделить, а у голоса должен стоять тип «Диалог» (задача «Выровнять звук»).';
      }],
      ['Звук тише на 3 дБ', 'Выделенные клипы (или все)', async () => { const q = await workSequence(); await run('clip.audioGain', { clips: pickClips(q, 'audio').map((c) => c.clip), mode: 'adjust', db: -3 }); }],
      ['Звук громче на 3 дБ', 'Выделенные клипы (или все)', async () => { const q = await workSequence(); await run('clip.audioGain', { clips: pickClips(q, 'audio').map((c) => c.clip), mode: 'adjust', db: 3 }); }],
    ]],
    ['Цвет', [
      ['Ярче и сочнее', 'Экспозиция +0,3, контраст +15, насыщенность 115', async () => {
        const q = await workSequence();
        for (const c of pickClips(q, 'video')) {
          const has = (c.effects || []).some((e) => e.effect === 'lumetri');
          if (!has) await run('effects.apply', { clips: [c.clip], effect: 'lumetri' });
          for (const [param, value] of [['exposure', 0.3], ['contrast', 15], ['saturation', 115]]) await run('effects.setParam', { clip: c.clip, effect: 'lumetri', param, value });
        }
      }],
      ['Тёплый тон', 'Температура +20', async () => {
        const q = await workSequence();
        for (const c of pickClips(q, 'video')) {
          if (!(c.effects || []).some((e) => e.effect === 'lumetri')) await run('effects.apply', { clips: [c.clip], effect: 'lumetri' });
          await run('effects.setParam', { clip: c.clip, effect: 'lumetri', param: 'temperature', value: 20 });
        }
      }],
    ]],
    ['Экспорт', [
      ['Скачать MP4 (H.264)', 'Как в последовательности, звук −14 LUFS', async () => exportVideo({ loudnessLufs: -14 }, 'MP4')],
      ['Скачать MP4 720p', 'Меньше файл, быстрее отправить', async () => {
        const q = await workSequence();
        const st = q.settings || {}; const w = st.width || 1920, h = st.height || 1080;
        const k = 720 / Math.min(w, h);
        return exportVideo({ width: Math.round(w * k / 2) * 2, height: Math.round(h * k / 2) * 2, loudnessLufs: -14 }, 'MP4 720p');
      }],
      ['Скачать звук MP3', 'Только звук ролика', async () => { const q = await workSequence(); await PC.exec('file.exportMedia', { path: await exportName('.mp3'), format: 'mp3', sequence: q.id }); return 'Экспорт звука идёт, файл скачается в браузере.'; }],
      ['Сохранить на сервер', 'Ctrl+S, в «Мои проекты» вместе с медиа', async () => { await Files.save(false); return 'skip'; }],
      ['Новый проект', 'Пустой', async () => { if (await newProject()) Files.forget(); return 'skip'; }],
    ]],
    ['Попросить помощника', [
      ['Разобрать монтаж', 'Что на дорожках, что улучшить', '?Разбери монтаж: какие клипы и дорожки, переходы, титры, субтитры, звук — и что стоит улучшить для короткого ролика.'],
      ['Смонтировать ролик', 'Из клипов в «Проекте»', '!Собери из медиа в панели «Проект» ролик: последовательность по первому видео, клипы по порядку на V1, плавные переходы, титр с названием в начале.'],
      ['Субтитры из текста', 'Вставьте текст — разложу по времени', '!Сделай субтитры из этого текста, равномерно по длине ролика, не больше двух строк по 42 знака: '],
      ['Главы по маркерам', 'Для описания на YouTube/VK', '?Составь главы ролика с таймкодами по маркерам и титрам.'],
      ['Вертикальная версия', 'Тот же монтаж 1080×1920', '!Сделай вертикальную версию ролика 1080×1920: новая последовательность, те же клипы, кадр заполнен.'],
    ]],
  ];
  const Gallery = (() => {
    function show(on = true) {
      $('gallery').hidden = !on;
      if (on) renderTasks();
    }
    function renderTasks() {
      $('gTasks').innerHTML = TASKS.map(([group, items], gi) => `<section><h4>${esc(group)}</h4><div>${items.map(([n, d], i) => `<button class="st-task" data-g="${gi}" data-i="${i}"><b>${esc(n)}</b><small>${esc(d)}</small></button>`).join('')}</div></section>`).join('');
      $('gTasks').querySelectorAll('.st-task').forEach((b) => {
        const [, , task] = TASKS[+b.dataset.g][1][+b.dataset.i];
        b.onclick = async () => {
          if (typeof task === 'string') {
            show(false);
            setOpen(true);
            setMode(task.startsWith('?') ? 'advice' : 'act');
            const text = task.replace(/^[!?]/, '');
            input.value = text;
            if (text.endsWith(': ')) { autosize(); input.focus(); input.setSelectionRange(text.length, text.length); }
            else send();
            return;
          }
          b.disabled = true;
          undoSteps = 0;
          try {
            const note = await task();
            show(false);
            if (note !== 'skip') toast((note || 'Готово: ' + b.querySelector('b').textContent + '.') + (undoSteps ? ' Отменить — Ctrl+Z' + (undoSteps > 1 ? ` (${undoSteps} шаг.)` : '') + '.' : ''));
          } catch (e) { toast(e.message, true); }
          finally { b.disabled = false; }
        };
      });
    }
    function start() {
      $('galleryBtn').onclick = () => show(true);
      $('galleryClose').onclick = () => show(false);
      $('gallery').addEventListener('pointerdown', (e) => { if (e.target === $('gallery')) show(false); });
      $('gallery').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); show(false); } });
    }
    return { start, show };
  })();

  // ------------------------------------------------------------------ ИИ у выделения
  // Кнопка «ИИ» в шапке редактора присылает событие aipremiere:ai; Ctrl+Alt+Пробел открывает то же
  // меню над окном. Текст в видеопроекте — это субтитры, тексты титров, маркеры и названия клипов.
  // Выделены субтитры — они; выделены титры — их тексты; выделены другие клипы — их названия; ничего —
  // все субтитры, а без них — маркеры; нет и маркеров — ролик целиком (главы, описание, названия).
  // Модель видит план всего ролика (api/context.php), а результат не попадает в проект сам:
  // его можно применить (заменить тексты), положить переводом на новую дорожку субтитров или скопировать.
  const AI_MENU = [
    ['Субтитры', [['subs_improve', 'Улучшить'], ['subs_fix', 'Исправить ошибки'], ['subs_short', 'Сократить, чтобы успевали читать'], ['subs_lines', 'Расставить переносы строк']]],
    ['Титры', [['titles_improve', 'Короче и ярче'], ['titles_fix', 'Исправить ошибки']]],
    ['Названия', [['names_clear', 'Понятные названия'], ['names_fix', 'Исправить ошибки']]],
    ['Перевод', [['translate_en', 'На английский'], ['translate_ru', 'На русский'], ['translate_de', 'На немецкий'], ['translate_es', 'На испанский'], ['translate_zh', 'На китайский']]],
    ['Публикация', [['chapters', 'Главы с таймкодами'], ['description', 'Описание ролика'], ['video_titles', 'Варианты названия'], ['hashtags', 'Хэштеги'], ['summary', 'Что в проекте']]],
  ];
  // Эти операции дают новый текст для каждого элемента — по одному на строку, в том же порядке.
  const AI_LINES = /^(subs_|titles_|names_|translate_)/;
  const AI_LABEL = Object.fromEntries(AI_MENU.flatMap((g) => g[1]));
  const LANG_OF = { translate_en: 'en', translate_ru: 'ru', translate_de: 'de', translate_es: 'es', translate_zh: 'zh' };
  const LANG_NAME = { en: 'English', ru: 'Русский', de: 'Deutsch', es: 'Español', zh: '中文' };

  // Markdown модели → простой HTML: абзацы, подзаголовки, списки, таблицы, полужирный и курсив.
  function mdToHtml(md) {
    const inline = (s) => esc(s)
      .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
      .replace(/(^|[\s(«])\*([^*\s][^*\n]*?)\*(?=[\s.,;:!?)»]|$)/g, '$1<i>$2</i>')
      .replace(/`([^`\n]+)`/g, '$1');
    const out = [];
    let list = null;
    let rows = null;
    const close = () => {
      if (list) { out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`); list = null; }
      if (rows) {
        const [head, ...body] = rows;
        const cells = (r, t) => r.map((c) => `<${t}>${inline(c)}</${t}>`).join('');
        out.push(`<table border="1" style="border-collapse:collapse"><thead><tr>${cells(head, 'th')}</tr></thead><tbody>${body.map((r) => `<tr>${cells(r, 'td')}</tr>`).join('')}</tbody></table>`);
        rows = null;
      }
    };
    for (const raw of String(md).replace(/\r/g, '').split('\n')) {
      const line = raw.trimEnd();
      let m;
      if (/^\s*\|.*\|\s*$/.test(line)) {
        if (list) close();
        if (/^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes('-')) continue; // строка-разделитель
        rows = rows || [];
        rows.push(line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
      } else if ((m = line.match(/^\s*[-*•–]\s+(.*)$/))) {
        if (rows || (list && list.tag !== 'ul')) close();
        list = list || { tag: 'ul', items: [] };
        list.items.push(m[1]);
      } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
        if (rows || (list && list.tag !== 'ol')) close();
        list = list || { tag: 'ol', items: [] };
        list.items.push(m[1]);
      } else if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
        close();
        const level = Math.min(4, Math.max(2, m[1].length));
        out.push(`<h${level}>${inline(m[2].replace(/#+\s*$/, ''))}</h${level}>`);
      } else if (!line.trim()) {
        close();
      } else {
        close();
        out.push(`<p>${inline(line.trim())}</p>`);
      }
    }
    close();
    return out.join('');
  }
  const mdPlain = (md) => String(md).replace(/\*\*([^*\n]+)\*\*/g, '$1').replace(/^#{1,6}\s+/gm, '').trim();
  const mdStructured = (md) => /^\s*([-*•–]\s|\d+[.)]\s|#{1,6}\s|\|)/m.test(md);
  // Строки результата без разметки Markdown: «- пункт» → «пункт», «# Заголовок» → «Заголовок».
  const mdLines = (md) => mdPlain(md).split('\n').map((l) => l.replace(/^\s*(?:[-*•–]|\d+[.)])\s+/, '').trim()).filter(Boolean);

  const ai = { pop: null, sel: null, op: null, custom: '', result: '', abort: null };

  function aiClose() {
    if (ai.abort) ai.abort.abort();
    ai.abort = null;
    ai.pop?.remove();
    ai.pop = null;
  }
  function aiPlace(x, y) {
    const pop = ai.pop;
    const w = pop.offsetWidth; const h = pop.offsetHeight;
    const left = Math.max(8, Math.min(x, window.innerWidth - w - 8));
    const top = y + h + 8 <= window.innerHeight ? y : Math.max(8, Math.min(y - h - 12, window.innerHeight - h - 8));
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }
  const KIND_TEXT = { caption: 'Субтитры', title: 'Титры', clip: 'Клипы', marker: 'Маркеры', project: 'Проект' };
  const tc = (s) => { const t = Math.max(0, Math.round(Number(s) || 0)); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), x = t % 60; return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(x).padStart(2, '0'); };
  // Перенос строки внутри субтитра или титра модель видит как «⏎» (один элемент — одна строка).
  const oneLine = (t) => String(t || '').replace(/\r?\n/g, ' ⏎ ');
  const multiLine = (t) => String(t || '').replace(/\s*⏎\s*/g, '\n').trim();
  // Тексты титров выделенных клипов (графических): по слою на элемент.
  async function titleLayers(clipIds, max) {
    const out = [];
    for (const id of clipIds.slice(0, max)) {
      try {
        const g = await PC.exec('graphics.list', { clip: id });
        for (const l of g.layers || []) if (l.kind === 'text' && l.text) out.push({ kind: 'title', clip: id, layer: l.layer, text: l.text, at: secs(g.start) });
      } catch { /* не титр */ }
    }
    return out;
  }
  // Что выделено: субтитры, титры, клипы, маркеры или ничего (весь ролик).
  async function aiSelection() {
    const q = await sequence();
    const caps = await captionTracks();
    let items = [];
    const allCaps = (caps.tracks || []).flatMap((t) => (t.captions || []).map((c) => ({ kind: 'caption', id: c.id, track: t.id, language: t.language, text: c.text, at: secs(c.start), len: secs(c.end - c.start), start: c.start, end: c.end })));
    const capSel = new Set(caps.selection || []);
    if (capSel.size) items = allCaps.filter((c) => capSel.has(c.id));
    const clipSel = (q && q.selection) || [];
    if (!items.length && clipSel.length) {
      items = await titleLayers(clipSel, 40);
      if (!items.length) {
        const byId = new Map([...(q.video || []), ...(q.audio || [])].flatMap((t) => t.items || []).map((c) => [c.clip, c]));
        items = clipSel.map((id) => byId.get(id)).filter(Boolean).map((c) => ({ kind: 'clip', id: c.clip, text: c.name, at: secs(c.start) }));
      }
    }
    if (!items.length && allCaps.length) {
      const first = allCaps[0].track;
      items = allCaps.filter((c) => c.track === first);
    }
    if (!items.length && q && (q.markers || []).length) items = q.markers.map((m) => ({ kind: 'marker', id: m.id, text: m.name || '', comment: m.comment || '', at: secs(m.start) }));
    const kind = items.length ? items[0].kind : 'project';
    items = items.slice(0, 400);
    const text = items.map((it) => (kind === 'caption' ? `[${tc(it.at)}, ${String(it.len).replace('.', ',')} с] ` : it.at != null ? `[${tc(it.at)}] ` : '') + oneLine(it.text)).join('\n');
    return { kind, items, text, project: await projectOutline(q, allCaps) };
  }
  // План ролика — контекст для модели: клипы со временем, тексты титров, субтитры, маркеры.
  async function projectOutline(q, allCaps) {
    const p = await project().catch(() => ({ name: '' }));
    if (!q) return `Проект «${p.name}»: последовательность не открыта.`;
    const out = [`Проект «${p.name}», последовательность «${q.name}», ${q.settings ? q.settings.width + '×' + q.settings.height : ''}, длина ${tc(secs(q.duration))}.`];
    const graphics = [];
    (q.video || []).forEach((t, i) => {
      out.push(`Дорожка V${i + 1}${t.name ? ' «' + t.name + '»' : ''}:`);
      for (const c of (t.items || []).slice(0, 120)) { out.push(`  [${tc(secs(c.start))}–${tc(secs(c.end))}] ${c.name}`); graphics.push(c.clip); }
    });
    (q.audio || []).forEach((t, i) => {
      out.push(`Дорожка A${i + 1}${t.name ? ' «' + t.name + '»' : ''}:`);
      for (const c of (t.items || []).slice(0, 120)) out.push(`  [${tc(secs(c.start))}–${tc(secs(c.end))}] ${c.name}`);
    });
    const titles = await titleLayers(graphics, 30);
    for (const t of titles) out.push(`Титр [${tc(t.at)}]: ${oneLine(t.text)}`);
    for (const m of q.markers || []) out.push(`Маркер [${tc(secs(m.start))}] ${m.name || ''}${m.comment ? ' — ' + m.comment : ''}`);
    for (const c of allCaps.slice(0, 1500)) out.push(`Субтитр [${tc(c.at)}] ${oneLine(c.text)}`);
    return out.join('\n');
  }
  async function aiOpen(x, y) {
    aiClose();
    if (!PC.ready()) return;
    let sel;
    try { sel = await aiSelection(); } catch { toast('Редактор ещё загружается.', true); return; }
    sel.text = String(sel.text || '').slice(0, CFG.aiMaxChars || 60000);
    ai.sel = sel;
    const n = sel.items.length;
    const what = KIND_TEXT[sel.kind];
    const first = sel.items.slice(0, 3).map((it) => oneLine(it.text)).join(', ') + (n > 3 ? '…' : '');
    const pop = document.createElement('div');
    pop.className = 'st-ai-pop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'ИИ-помощник');
    pop.innerHTML = `
      <div class="st-ai-head">
        <span class="st-ai-mark">${ICON.spark}</span>
        <input class="st-ai-input" type="text" placeholder="${n ? 'Что сделать с текстом?' : 'Что написать о ролике?'}" aria-label="Свой запрос или поиск по меню" autocomplete="off">
        <button class="st-ai-x" title="Закрыть (Esc)" aria-label="Закрыть">${ICON.x}</button>
      </div>
      <div class="st-ai-scope">${n ? `${esc(what)}: <b>${esc(first.length > 80 ? first.slice(0, 80) + '…' : first)}</b> · ${n} ${plural(n, 'шт.', 'шт.', 'шт.')}` : 'Ничего не выделено, субтитров и маркеров нет — работаю с роликом целиком. Чтобы править текст, выделите субтитры, титры или клипы.'}</div>
      <div class="st-ai-body"></div>
      <div class="st-ai-foot">Enter — свой запрос · Esc — закрыть · Ctrl+Alt+Пробел — открыть над окном</div>`;
    root.appendChild(pop);
    ai.pop = pop;
    const input = pop.querySelector('.st-ai-input');
    pop.querySelector('.st-ai-x').onclick = aiClose;
    input.addEventListener('input', () => aiMenu(input.value));
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); aiClose(); }
      if (e.key === 'Enter' && input.value.trim()) { e.preventDefault(); aiRun('custom', input.value.trim()); }
      if (e.key === 'ArrowDown') { e.preventDefault(); pop.querySelector('.st-ai-item')?.focus(); }
    });
    pop.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); aiClose(); }
      const items = [...pop.querySelectorAll('.st-ai-item')];
      const i = items.indexOf(document.activeElement);
      if (i >= 0 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault(); e.stopPropagation();
        (items[i + (e.key === 'ArrowDown' ? 1 : -1)] || (e.key === 'ArrowUp' ? input : items[i])).focus();
      }
    });
    aiMenu('');
    ai.anchor = [x, y];
    aiPlace(x, y);
    input.focus();
  }
  function plural(n, one, few, many) {
    const d = n % 10; const h = n % 100;
    return d === 1 && h !== 11 ? one : d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many;
  }
  // Пункт меню доступен, если есть с чем работать: субтитры — когда выбраны субтитры, и т. д.
  function aiAllowed(id) {
    const s = ai.sel || { kind: 'project', items: [] };
    if (/^subs_/.test(id)) return s.kind === 'caption';
    if (/^titles_/.test(id)) return s.kind === 'title';
    if (/^names_/.test(id)) return s.kind === 'clip' || s.kind === 'marker';
    if (/^translate_/.test(id)) return s.items.length > 0;
    return true;
  }
  function aiMenu(query) {
    const body = ai.pop?.querySelector('.st-ai-body');
    if (!body) return;
    const q = query.trim().toLowerCase();
    const groups = AI_MENU
      .map(([g, items]) => [g, items.filter(([id, label]) => (!q || label.toLowerCase().includes(q) || g.toLowerCase().includes(q)) && aiAllowed(id))])
      .filter((g) => g[1].length);
    body.innerHTML = groups.length
      ? groups.map(([g, items]) => `<div class="st-ai-group"><div class="st-ai-gt">${esc(g)}</div><div class="st-ai-items">${items.map(([id, label]) => `<button class="st-ai-item" data-op="${id}">${esc(label)}</button>`).join('')}</div></div>`).join('')
      : `<button class="st-ai-item st-ai-custom" data-op="custom">${ICON.send}<span>Выполнить: «${esc(query.trim())}»</span></button>`;
    body.querySelectorAll('.st-ai-item').forEach((b) => {
      b.onclick = () => (b.dataset.op === 'custom' ? aiRun('custom', query.trim()) : aiRun(b.dataset.op, ''));
    });
    if (ai.anchor) aiPlace(...ai.anchor);
  }
  // Что можно сделать с результатом: [действие, подпись, главное?].
  function aiActions(op) {
    const s = ai.sel || { items: [] };
    const acts = [];
    const lines = AI_LINES.test(op) || op === 'custom';
    if (lines && s.kind === 'caption' && LANG_OF[op]) acts.push(['newtrack', `Новой дорожкой субтитров (${LANG_NAME[LANG_OF[op]]})`, true]);
    if (lines && s.items.length) acts.push(['replace', `Заменить текст (${s.items.length})`, AI_LINES.test(op) && !(s.kind === 'caption' && LANG_OF[op])]);
    return acts;
  }
  async function aiRun(op, custom) {
    if (!ai.pop) return;
    ai.op = op; ai.custom = custom;
    const body = ai.pop.querySelector('.st-ai-body');
    const title = op === 'custom' ? custom : (AI_LABEL[op] || op);
    body.innerHTML = `<div class="st-ai-res"><div class="st-ai-rt">${esc(title)}</div><div class="st-ai-wait"><div class="st-typing"><i></i><i></i><i></i></div><span>Думаю…</span><button class="st-mini" data-a="stop">Отменить</button></div></div>`;
    ai.pop.querySelector('.st-ai-foot').hidden = true;
    body.querySelector('[data-a="stop"]').onclick = () => { ai.abort?.abort(); aiMenu(ai.pop.querySelector('.st-ai-input').value); ai.pop.querySelector('.st-ai-foot').hidden = false; };
    aiPlace(...ai.anchor);
    const sel = ai.sel || { kind: 'project', items: [], text: '', project: '' };
    let extra = '';
    if ((AI_LINES.test(op) || op === 'custom') && sel.items.length) extra = `Элементов: ${sel.items.length} (${(KIND_TEXT[sel.kind] || '').toLowerCase()}). Если задача — переписать или перевести тексты, верни ровно ${sel.items.length} строк, по одной на элемент, в том же порядке, без номеров и таймкодов; перенос строки внутри элемента — символ ⏎.`;
    ai.abort = new AbortController();
    const payload = { mode: 'text', op: op === 'custom' ? '' : op, custom: op === 'custom' ? custom : '', extra, kind: sel.kind, selection: sel.text || '', document: sel.project || '' };
    let j;
    try {
      const r = await fetch(CFG.api, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: ai.abort.signal });
      j = await readAnswer(r);
    } catch (e) {
      if (e.name === 'AbortError') return;
      j = { ok: false, error: e.message };
    }
    ai.abort = null;
    if (!ai.pop) return;
    if (!j || !j.ok) {
      body.innerHTML = `<div class="st-ai-res"><div class="st-ai-rt">${esc(title)}</div><p class="st-ai-err">${esc((j && j.error) || 'Модель не ответила.')}</p><div class="st-ai-acts"><button class="st-mini" data-a="back">Назад</button><button class="st-mini" data-a="again">Ещё раз</button></div></div>`;
    } else {
      ai.result = String(j.message?.content || '').trim();
      const acts = aiActions(op);
      body.innerHTML = `<div class="st-ai-res">
        <div class="st-ai-rt">${esc(title)}<small>${esc(j.context === 'windowed' ? 'проект большой: учтена его часть' : 'учтён весь проект')}</small></div>
        <div class="st-ai-out">${mdToHtml(ai.result) || '<p>(пустой ответ)</p>'}</div>
        <div class="st-ai-acts">
          ${acts.map(([a, label, main]) => `<button class="st-mini ${main ? 'primary' : ''}" data-a="${a}">${esc(label)}</button>`).join('')}
          <button class="st-mini ${acts.some((x) => x[2]) ? '' : 'primary'}" data-a="copy">Копировать</button>
          <button class="st-mini" data-a="again" title="Другой вариант">Ещё вариант</button>
          <button class="st-mini" data-a="back">Назад</button>
        </div></div>`;
    }
    body.querySelectorAll('[data-a]').forEach((b) => { b.onclick = () => aiAction(b.dataset.a); });
    aiPlace(...ai.anchor);
    body.querySelector('.primary, [data-a="again"]')?.focus();
  }
  // Строка результата без таймкода и кавычек.
  const nameLine = (l) => l.replace(/^\[[\d:.,\sс–-]+\]\s*/, '').replace(/^["«„]|["»“]$/g, '').trim();
  async function aiAction(a) {
    if (a === 'back') { aiMenu(ai.pop.querySelector('.st-ai-input').value); ai.pop.querySelector('.st-ai-foot').hidden = false; return; }
    if (a === 'again') { aiRun(ai.op, ai.custom); return; }
    if (a === 'copy') {
      const text = mdPlain(ai.result).replace(/\s*⏎\s*/g, '\n');
      try { await navigator.clipboard.writeText(text); } catch {
        const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select();
        try { document.execCommand('copy'); } catch { /* нет доступа к буферу */ }
        t.remove();
      }
      toast('Скопировано');
      return;
    }
    const sel = ai.sel || { items: [] };
    try {
      const lines = mdLines(ai.result).map(nameLine).filter(Boolean);
      if (lines.length !== sel.items.length) throw new Error(`модель вернула ${lines.length} строк, а элементов ${sel.items.length}. Нажмите «Ещё вариант»`);
      if (a === 'replace') {
        let steps = 0;
        for (let i = 0; i < lines.length; i++) {
          const it = sel.items[i];
          const text = multiLine(lines[i]);
          if (text === String(it.text || '').trim()) continue;
          if (it.kind === 'caption') await PC.exec('captions.setText', { caption: it.id, text });
          else if (it.kind === 'title') await PC.exec('graphics.setText', { clip: it.clip, layer: it.layer, text });
          else if (it.kind === 'clip') await PC.exec('clip.rename', { clip: it.id, name: text.replace(/\n/g, ' ').slice(0, 200) });
          else if (it.kind === 'marker') await PC.exec('markers.edit', { target: 'program', marker: it.id, name: text.replace(/\n/g, ' ').slice(0, 200) });
          steps++;
        }
        aiClose();
        toast(steps ? `Заменено: ${steps}. Отменить — Ctrl+Z` : 'Текст и так такой.');
        return;
      }
      if (a === 'newtrack') {
        const lang = LANG_OF[ai.op] || 'en';
        const r = await PC.exec('captions.newTrack', { format: 'Subtitle', name: 'Субтитры (' + LANG_NAME[lang] + ')', language: lang });
        const track = r && (r.id ?? r.track);
        for (let i = 0; i < lines.length; i++) {
          const it = sel.items[i];
          const p = { text: multiLine(lines[i]), time: it.start, durationSeconds: Math.max(0.1, (it.end - it.start) / TPS) };
          if (track != null) p.track = track;
          await PC.exec('captions.add', p);
        }
        aiClose();
        toast(`Перевод — на новой дорожке субтитров (${lines.length}). Отменить — Ctrl+Z`);
      }
    } catch (e) {
      toast('Не получилось: ' + e.message, true);
    }
  }
  window.addEventListener('aipremiere:ai', (e) => {
    const c = document.getElementById('filmcraft_canvas');
    const r = c ? c.getBoundingClientRect() : { left: 0, top: 0 };
    const d = e.detail || {};
    aiOpen(r.left + (Number(d.x) || 0), r.top + (Number(d.y) || 0));
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && e.altKey && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
      e.preventDefault();
      e.stopImmediatePropagation();
      const c = document.getElementById('filmcraft_canvas');
      const r = c ? c.getBoundingClientRect() : { left: 0, top: 0, width: 800, height: 600 };
      aiOpen(r.left + Math.max(40, r.width / 2 - 200), r.top + Math.max(80, r.height / 4));
    }
  }, true);
  document.addEventListener('pointerdown', (e) => { if (ai.pop && !ai.pop.contains(e.target) && !ai.abort) aiClose(); }, true);

  // ------------------------------------------------------------------ тема
  // Тема редактора: фирменная (по умолчанию), светлая или тёмная. Панель — в тон.
  const THEMES = [['brand', 'Фирменная'], ['light', 'Светлая'], ['dark', 'Тёмная']];
  const systemDark = () => !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  function applyPanelTheme(themeId) {
    root.dataset.theme = themeId === 'brand' ? 'brand' : (themeId === 'dark' || (themeId === 'system' && systemDark()) ? 'dark' : 'light');
    document.documentElement.classList.toggle('studio-brand', themeId === 'brand');
    renderThemeMenu(themeId);
  }
  const syncBackdrop = () => {};
  function renderThemeMenu(current) {
    const menu = $('themeMenu');
    if (!menu) return;
    menu.innerHTML = THEMES.map((t) => `<button role="menuitemradio" aria-checked="${t[0] === current}" data-theme-id="${t[0]}">${esc(t[1])}</button>`).join('');
    menu.querySelectorAll('button').forEach((b) => { b.onclick = () => { toggleThemeMenu(false); setTheme(b.dataset.themeId); }; });
  }
  function toggleThemeMenu(open) {
    const menu = $('themeMenu');
    if (!menu) return;
    const show = open == null ? menu.hidden : open;
    menu.hidden = !show;
    $('theme').setAttribute('aria-expanded', String(show));
  }
  async function setTheme(themeId) {
    applyPanelTheme(themeId);
    store.set('theme', themeId);
    if (PC.ready()) await PC.call('ui.set', { theme: themeId }).catch(() => {});
  }
  // Тема, которая сейчас в редакторе, как бы её ни выбрали (Просмотр › Оформление, настройки, панель).
  async function watchTheme() {
    for (;;) {
      if (!document.hidden && PC.ready()) {
        try {
          const a = await PC.exec('prefs.get', { key: 'appearance' });
          const mode = a && (a.appearanceMode || (a.appearance && a.appearance.appearanceMode));
          const dark = a && (a.darkTheme || (a.appearance && a.appearance.darkTheme));
          if (mode) applyPanelTheme(mode === 'light' ? 'light' : dark === 'brand' ? 'brand' : 'dark');
          // Заголовок вкладки браузера — имя проекта (окно браузера редактор сам не переименует).
          const d = await project().catch(() => null);
          document.title = d && d.name ? `${d.name}${d.dirty ? ' •' : ''} — AI Видео` : 'AI Видео';
        } catch { /* не важно */ }
      }
      await sleep(2000);
    }
  }

  async function status() {
    try {
      const r = await fetch(CFG.api, { credentials: 'same-origin' });
      const j = await r.json();
      if (j.ok) {
        if (Number(j.ctx) > 0) CTX = Number(j.ctx);
        if (j.source) $('sub').title = 'Откуда взята модель: ' + j.source;
        $('sub').textContent = 'Модель: ' + j.model;
        fetch('studio/version.json', { cache: 'no-store' }).then((v) => (v.ok ? v.json() : null)).then((v) => {
          if (!v || !v.build) return;
          const d = String(v.date || '').split('-').reverse().join('.');
          $('sub').textContent = 'Модель: ' + j.model + ' · сборка ' + v.build + (d ? ' от ' + d : '');
          const pageBuild = document.documentElement.dataset.build;
          if (pageBuild && pageBuild !== String(v.build)) {
            const page = +pageBuild, server = +v.build;
            if (page > server) {
              msg('note', `Страница — от сборки ${esc(pageBuild)}, а файлы на сервере частично остались от сборки ${esc(String(v.build))}: ` +
                'программа заливки, похоже, пропустила файлы того же размера. Удалите старую папку на сервере целиком и залейте новую ' +
                '(или включите в программе «перезаписывать всегда»).');
            } else {
              msg('note', `Открыта старая копия страницы из кэша браузера (сборка ${esc(pageBuild)}), а на сервере уже сборка ${esc(String(v.build))}. Нажмите <b>Ctrl+F5</b>, чтобы загрузить новую.`);
            }
          }
        }).catch(() => {});
      }
      else $('sub').textContent = j.login ? 'Нужно войти в систему' : (j.error || 'Нет связи с помощником');
    } catch {
      $('sub').textContent = 'Нет связи с сервером помощника';
    }
  }

  function autosize() { input.style.height = 'auto'; input.style.height = Math.min(160, input.scrollHeight) + 'px'; }

  function mount() {
    document.body.appendChild(root);
    root.querySelectorAll('.st-seg button').forEach((b) => { b.onclick = () => setMode(b.dataset.mode); });
    $('eye').onclick = () => setEye(!attachScreen);
    initAgentMenu();
    $('hide').onclick = () => setOpen(false);
    $('fab').onclick = () => { setOpen(true); setBadge(false); };
    $('send').onclick = () => send();
    $('barBtn').onclick = () => setBar(!root.classList.contains('bar-open'));
    $('barSend').onclick = () => (busy ? send() : sendFromBar());
    $('barMode').onclick = () => setMode(mode === 'act' ? 'advice' : 'act');
    barInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); sendFromBar(); }
      if (e.key === 'Escape') { e.preventDefault(); setBar(false); }
    });
    $('clear').onclick = () => { if (!busy) { convo = []; showEmpty(); } };
    // Луна/солнце — между светлой и тёмной неоморфными; из фирменной — в светлую.
    $('theme').onclick = (e) => { e.stopPropagation(); toggleThemeMenu(); };
    document.addEventListener('pointerdown', (e) => { if (!e.target.closest || !e.target.closest('.st-theme-wrap')) toggleThemeMenu(false); }, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggleThemeMenu(false); });
    input.addEventListener('input', autosize);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
    });
    setMode(mode);
    setEye(attachScreen);
    applyPanelTheme('brand');
    showEmpty();
    status();
  }

  async function boot() {
    mount();
    // Ждём, пока WebAssembly загрузится и поставит window.aipremiere, а редактор запустится и начнёт отвечать.
    while (!PC.ready()) await sleep(200);
    for (let i = 0; i < 600; i++) {
      try { await PC.call('ui.inspect'); break; } catch { await sleep(300); }
    }
    Files.start();
    // Тема, выбранная в этом браузере раньше (редактор каждый раз начинает с фирменной).
    const saved = store.get('theme', 'brand');
    if (saved !== 'brand') setTheme(saved);
    await sleep(300);
    root.classList.add('ready');
    if (store.get('open', CFG.openOnStart)) setOpen(true);
    commands().catch(() => {});
    watchTheme();
    Gallery.start();
    // Шрифты для титров — в фоне, когда редактор уже работает.
    setTimeout(() => { Fonts.start().catch(() => {}); }, 1500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
