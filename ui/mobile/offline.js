'use strict';
/* Offline do app Guitarr: músicas avulsas, álbuns e playlists guardados no aparelho, com limite de espaço,
 * qualidade (original ou convertida pelo servidor) e fila de downloads que continua sozinha.
 *
 * Dois "armazéns" com a mesma interface:
 *   - APK (Capacitor): arquivos reais em Directory.Data/offline/ (Filesystem.downloadFile, sem passar pela memória);
 *   - navegador/PWA: Cache Storage (como era antes).
 * Estado em localStorage ("seer_offline_v2"): faixas (com a lista de coleções que as seguram), coleções
 * (álbum/playlist), capas, fila e ajustes. Uma faixa só sai do disco quando nenhuma coleção a segura e ela
 * não foi pedida avulsa. */
(function () {
  var S = window.S, esc = S.esc;
  var Cap = window.Capacitor, NATIVE = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  var P = NATIVE ? (Cap.Plugins || {}) : {};
  var KEY = 'seer_offline_v2', LEGACY = 'seer_offline_meta', CACHE = 'seer-audio-offline-v1';
  var RESERVE = 500e6; // não deixa o aparelho com menos de 500 MB livres
  var QUALITIES = [
    { id: 'orig', kbps: 0, label: 'Original', hint: 'Sem perda (FLAC etc.). Ocupa 20 a 40 MB por música.' },
    { id: '320', kbps: 320, label: 'Alta · 320 kbps (MP3)', hint: 'Cerca de 2,4 MB por minuto. Convertida pelo servidor.' },
    { id: '192', kbps: 192, label: 'Média · 192 kbps (MP3)', hint: 'Cerca de 1,4 MB por minuto.' },
    { id: '128', kbps: 128, label: 'Econômica · 128 kbps (MP3)', hint: 'Cerca de 1 MB por minuto. Bom para guardar muita coisa.' }
  ];
  var LIMITS_GB = [1, 2, 5, 10, 20, 50];

  var st = S.off = { tracks: {}, cols: {}, covers: {}, queue: [], baseUri: '', device: null,
    settings: { limit: 0, quality: 'orig', wifiOnly: true },
    run: { active: false, cur: null, curPct: 0, blocked: '', done: 0, total: 0 } };
  S.offline = { ids: {}, meta: st.tracks }; // compatibilidade: meta = faixas guardadas

  // ---------------------------------------------------------------- estado ---
  function persist() {
    try {
      var keep = {};
      Object.keys(st.tracks).forEach(function (id) { var t = Object.assign({}, st.tracks[id]); delete t.dl; keep[id] = t; });
      S.ls(KEY, JSON.stringify({ v: 2, tracks: keep, cols: st.cols, covers: st.covers, queue: st.queue, settings: st.settings }));
    } catch (e) {}
  }
  function qual() { return QUALITIES.find(function (q) { return q.id === st.settings.quality; }) || QUALITIES[0]; }
  function isReady(t) { return !!t && t.status === 'ready'; }
  S.offlineHas = function (id) { return isReady(st.tracks[id]); };
  function ready() { return Object.keys(st.tracks).map(function (id) { return st.tracks[id]; }).filter(isReady); }
  function usedBytes() { return ready().reduce(function (n, t) { return n + (t.size || 0); }, 0); }
  function fmtLimit() { return st.settings.limit ? S.fmtBytes(st.settings.limit) : 'sem limite'; }
  function colKey(type, id) { return type + ':' + id; }
  function origCover() { return st.origCoverUrl || S.coverUrl; }

  function ext(t) { return qual().kbps ? 'mp3' : (String(t.suffix || 'flac').toLowerCase().replace(/[^a-z0-9]/g, '') || 'flac'); }
  function estSize(t) {
    var q = qual();
    if (q.kbps) return Math.round((t.duration || 200) * q.kbps * 1000 / 8);
    if (t.size) return t.size;
    return Math.round((t.duration || 200) * (t.lossless ? 900 : (t.bitRate || 256)) * 1000 / 8);
  }
  S.offlineEstimate = function (tracks) {
    return tracks.reduce(function (n, t) { return n + (S.offlineHas(t.id) ? 0 : estSize(t)); }, 0);
  };

  S.offlineLoad = async function () {
    var data = null;
    try { data = JSON.parse(S.ls(KEY) || 'null'); } catch (e) {}
    if (data && data.v === 2) {
      Object.keys(st.tracks).forEach(function (k) { delete st.tracks[k]; });
      Object.assign(st.tracks, data.tracks || {});
      st.cols = data.cols || {}; st.covers = data.covers || {}; st.queue = data.queue || [];
      st.settings = Object.assign({ limit: 0, quality: 'orig', wifiOnly: true }, data.settings || {});
    } else {
      // migra o formato antigo (só faixas avulsas)
      var old = {};
      try { old = JSON.parse(S.ls(LEGACY) || '{}') || {}; } catch (e) {}
      Object.keys(old).forEach(function (id) { st.tracks[id] = Object.assign({}, old[id], { status: 'ready', direct: true, cols: [], ext: String(old[id].suffix || 'flac').toLowerCase(), savedAt: old[id].savedAt || Date.now() }); });
      if (Object.keys(old).length) persist();
    }
    // download interrompido (app fechado no meio): volta para a fila
    Object.keys(st.tracks).forEach(function (id) { var t = st.tracks[id]; if (t.status === 'downloading') t.status = 'queued'; });
    st.queue = st.queue.filter(function (id) { return st.tracks[id] && st.tracks[id].status === 'queued'; });
    Object.keys(st.tracks).forEach(function (id) { if (st.tracks[id].status === 'queued' && st.queue.indexOf(id) < 0) st.queue.push(id); });
    await B.init();
    refreshDevice();
  };

  // ---------------------------------------------------------------- armazéns ---
  var cacheBackend = {
    init: async function () {},
    key: function (id) { return new Request(location.origin + '/__offline/' + encodeURIComponent(id)); },
    put: async function (kind, id, url, extn, onProgress) {
      if (kind !== 'audio') return 0;
      if (!('caches' in window)) throw new Error('Este navegador não guarda arquivos offline');
      var r = await fetch(url);
      if (!r.ok) throw new Error('Servidor respondeu ' + r.status);
      var total = Number(r.headers.get('content-length')) || 0, chunks = [], got = 0, rd = r.body && r.body.getReader ? r.body.getReader() : null;
      if (rd) {
        for (;;) { var c = await rd.read(); if (c.done) break; chunks.push(c.value); got += c.value.length; if (onProgress && total) onProgress(got / total); }
      } else { var b = await r.blob(); chunks.push(b); got = b.size; }
      var cache = await caches.open(CACHE);
      await cache.put(cacheBackend.key(id), new Response(new Blob(chunks), { headers: { 'content-type': r.headers.get('content-type') || 'audio/mpeg' } }));
      return got;
    },
    src: async function (kind, id) {
      if (kind !== 'audio') return null;
      try { var c = await caches.open(CACHE), r = await c.match(cacheBackend.key(id)); return r ? URL.createObjectURL(await r.blob()) : null; } catch (e) { return null; }
    },
    localCover: function () { return null; },
    del: async function (kind, id) { if (kind !== 'audio') return; try { var c = await caches.open(CACHE); await c.delete(cacheBackend.key(id)); } catch (e) {} },
    wipe: async function () { try { await caches.delete(CACHE); } catch (e) {} },
    free: async function () {
      try { var e = await navigator.storage.estimate(); return { free: (e.quota || 0) - (e.usage || 0), total: e.quota || 0 }; } catch (er) { return null; }
    }
  };
  var progressByUrl = {};
  var nativeBackend = {
    Fs: function () { return P.Filesystem; },
    path: function (kind, id, extn) { return kind === 'cover' ? 'offline/covers/' + id + '.jpg' : 'offline/' + id + '.' + extn; },
    init: async function () {
      var Fs = nativeBackend.Fs();
      try { await Fs.mkdir({ path: 'offline/covers', directory: 'DATA', recursive: true }); } catch (e) { /* já existe */ }
      var u = await Fs.getUri({ path: 'offline', directory: 'DATA' });
      st.baseUri = String(u.uri || '').replace(/\/+$/, '');
      try { Fs.addListener('progress', function (ev) { var f = progressByUrl[ev.url]; if (f && ev.contentLength > 0) f(ev.bytes / ev.contentLength); }); } catch (e) {}
    },
    put: async function (kind, id, url, extn, onProgress) {
      var Fs = nativeBackend.Fs(), path = nativeBackend.path(kind, id, extn);
      if (onProgress) progressByUrl[url] = onProgress;
      try { await Fs.downloadFile({ url: url, path: path, directory: 'DATA', recursive: true, progress: !!onProgress }); }
      finally { delete progressByUrl[url]; }
      var s = await Fs.stat({ path: path, directory: 'DATA' });
      return Number(s.size) || 0;
    },
    fileUrl: function (kind, id, extn) {
      var rel = kind === 'cover' ? 'covers/' + id + '.jpg' : id + '.' + extn;
      return Cap.convertFileSrc(st.baseUri + '/' + rel);
    },
    src: async function (kind, id, extn) { return nativeBackend.fileUrl(kind, id, extn); },
    localCover: function (id) { return st.covers[id] ? nativeBackend.fileUrl('cover', id) : null; },
    del: async function (kind, id, extn) { try { await nativeBackend.Fs().deleteFile({ path: nativeBackend.path(kind, id, extn), directory: 'DATA' }); } catch (e) {} },
    wipe: async function () {
      try { await nativeBackend.Fs().rmdir({ path: 'offline', directory: 'DATA', recursive: true }); } catch (e) {}
      try { await nativeBackend.Fs().mkdir({ path: 'offline/covers', directory: 'DATA', recursive: true }); } catch (e) {}
    },
    free: async function () {
      try { var r = await P.SeerNative.getStorage(); return { free: Number(r.free) || 0, total: Number(r.total) || 0 }; } catch (e) { return null; }
    }
  };
  var B = NATIVE && P.Filesystem ? nativeBackend : cacheBackend;
  S.offlineNative = B === nativeBackend;

  // capas guardadas no aparelho (só no APK): aparecem sem rede e não gastam dados
  if (B === nativeBackend) {
    st.origCoverUrl = S.coverUrl;
    S.coverUrl = function (id, size) { return B.localCover(id) || st.origCoverUrl(id, size); };
  }

  async function refreshDevice() { st.device = await B.free(); }

  // ---------------------------------------------------------------- reprodução ---
  S.offlineSrc = async function (id) {
    var t = st.tracks[id]; if (!isReady(t)) return null;
    var u = await B.src('audio', id, t.ext || ext(t));
    if (u) { t.lastPlayed = Date.now(); }
    return u;
  };

  // ---------------------------------------------------------------- fila ---
  function network() {
    if (NATIVE && P.SeerNative && P.SeerNative.getNetwork) return P.SeerNative.getNetwork().catch(function () { return { connected: navigator.onLine, wifi: true }; });
    var c = navigator.connection;
    return Promise.resolve({ connected: navigator.onLine, wifi: !(c && c.type === 'cellular') });
  }
  function keepAlive() {
    if (!NATIVE || !P.SeerNative) return;
    var r = st.run;
    if (r.active) P.SeerNative.keepAlive({ title: 'Baixando para ouvir offline', text: r.done + ' de ' + r.total + (r.cur ? ' · ' + r.cur : ''), progress: r.total ? Math.round((r.done + r.curPct) / r.total * 100) : 0 }).catch(function () {});
    else P.SeerNative.keepAliveStop().catch(function () {});
  }
  function queuedCount() { return st.queue.length; }
  function canFit(t) {
    var est = estSize(t), used = usedBytes();
    if (st.settings.limit && used + est > st.settings.limit) return { ok: false, msg: 'Limite de ' + fmtLimit() + ' atingido (usado ' + S.fmtBytes(used) + ').' };
    if (st.device && st.device.free && st.device.free - est < RESERVE) return { ok: false, msg: 'Pouco espaço livre no aparelho (' + S.fmtBytes(st.device.free) + ').' };
    return { ok: true };
  }
  var pumping = false, pumpTimer = null;
  S.offlinePump = async function () {
    if (pumping) return;
    pumping = true;
    var r = st.run;
    try {
      r.blocked = '';
      if (!queuedCount()) { r.active = false; return; }
      r.active = true; r.done = 0; r.total = queuedCount();
      keepAlive(); paintSoon();
      while (queuedCount()) {
        if (!S.online || !S.auth) { r.blocked = 'Sem conexão. Continua quando voltar.'; break; }
        var net = await network();
        if (!net.connected) { r.blocked = 'Sem conexão. Continua quando voltar.'; break; }
        if (st.settings.wifiOnly && !net.wifi) { r.blocked = 'Aguardando Wi‑Fi (você escolheu baixar só no Wi‑Fi).'; break; }
        await refreshDevice();
        var id = st.queue[0], t = st.tracks[id];
        if (!t) { st.queue.shift(); continue; }
        var fit = canFit(t);
        if (!fit.ok) { r.blocked = fit.msg; break; }
        r.cur = t.title; r.curPct = 0; t.status = 'downloading'; keepAlive(); paintSoon();
        try {
          var q = qual(), extn = ext(t);
          var url = S.streamUrl(t.id) + (q.kbps ? '&format=mp3&maxBitRate=' + q.kbps : '&format=raw');
          var size = await B.put('audio', t.id, url, extn, function (p) { r.curPct = p; paintSoon(); });
          if (st.settings.limit && usedBytes() + size > st.settings.limit * 1.02) {
            await B.del('audio', t.id, extn); t.status = 'queued';
            r.blocked = 'Limite de ' + fmtLimit() + ' atingido (usado ' + S.fmtBytes(usedBytes()) + ').'; break;
          }
          t.status = 'ready'; t.size = size; t.ext = extn; t.q = q.id; t.savedAt = Date.now(); delete t.error; t.fail = 0;
          st.queue.shift(); r.done++; r.curPct = 0;
          if (B === nativeBackend && t.albumId && !st.covers[t.albumId]) {
            try { await B.put('cover', t.albumId, origCover()(t.albumId, 400), 'jpg'); st.covers[t.albumId] = 1; } catch (e) {}
          }
        } catch (e) {
          t.fail = (t.fail || 0) + 1; t.status = 'queued';
          if (t.fail >= 3) { t.status = 'failed'; t.error = S.errMsg(e); st.queue.shift(); r.done++; }
          else { st.queue.push(st.queue.shift()); } // tenta as outras antes de insistir
        }
        persist(); paintSoon();
      }
    } finally {
      pumping = false; r.active = false; r.cur = null; r.curPct = 0;
      persist(); keepAlive(); refreshDevice().then(paintSoon); paintSoon();
      if (queuedCount() && !st.run.blocked) setTimeout(S.offlinePump, 1500);
      else if (queuedCount()) { clearTimeout(pumpTimer); pumpTimer = setTimeout(S.offlinePump, 45000); }
      else if (r.done) { S.toast('Offline: ' + r.done + ' faixa' + (r.done > 1 ? 's' : '') + ' salva' + (r.done > 1 ? 's' : '')); r.done = 0; }
    }
  };
  function enqueue(t) {
    var cur = st.tracks[t.id];
    if (!cur) {
      cur = st.tracks[t.id] = Object.assign({}, t, { status: 'queued', cols: [], direct: false, fail: 0 });
    } else if (cur.status === 'failed') { cur.status = 'queued'; cur.fail = 0; }
    if (cur.status === 'queued' && st.queue.indexOf(t.id) < 0) st.queue.push(t.id);
    return cur;
  }

  // ---------------------------------------------------------------- faixas avulsas ---
  S.offlineSave = async function (t) { // "Manter offline" no menu da música
    var cur = enqueue(t); cur.direct = true;
    persist(); S.toast('Baixando para uso offline…'); paintSoon(); S.offlinePump();
  };
  S.offlineRemove = async function (id) {
    var t = st.tracks[id]; if (!t) return;
    if ((t.cols || []).length) {
      var c = st.cols[t.cols[0]];
      S.toast('Faz parte de "' + (c ? c.name : 'um álbum/playlist') + '", que está offline. Remova por lá.'); return;
    }
    await dropTrack(id); persist(); paintSoon();
  };
  async function dropTrack(id) {
    var t = st.tracks[id]; if (!t) return;
    if (t.status === 'ready') await B.del('audio', id, t.ext || ext(t));
    delete st.tracks[id];
    st.queue = st.queue.filter(function (x) { return x !== id; });
  }

  // ---------------------------------------------------------------- coleções (álbum / playlist) ---
  function resolveCol(type, id) {
    if (type === 'album') {
      var a = S.albums.find(function (x) { return x.id === id; });
      var tr = S.tracks.filter(function (t) { return t.albumId === id && t.kind === 'song'; })
        .sort(function (x, y) { return (x.disc - y.disc) || (x.track - y.track); });
      return Promise.resolve({ name: a ? a.name : (tr[0] ? tr[0].album : 'Álbum'), artist: a ? a.artist : (tr[0] ? tr[0].artist : ''), tracks: tr });
    }
    if (id === '__fav') return Promise.resolve({ name: 'Músicas Curtidas', tracks: S.tracks.filter(S.isFav) });
    var pl = S.playlists.find(function (x) { return x.id === id; });
    if (S.plTracks && S.plTracks[id]) return Promise.resolve({ name: pl ? pl.name : 'Playlist', tracks: S.plTracks[id] });
    return S.subsonic('getPlaylist', { id: id }).then(function (d) {
      var es = (d.playlist && d.playlist.entry) || [];
      return { name: (d.playlist && d.playlist.name) || (pl && pl.name) || 'Playlist', tracks: es.map(function (e) { return S.byId[e.id] || S.mkTrack(e); }) };
    });
  }
  function attach(key, t) {
    var cur = enqueue(t);
    if (cur.cols.indexOf(key) < 0) cur.cols.push(key);
    return cur;
  }
  S.offlineAddCollection = async function (type, id) {
    var key = colKey(type, id), info;
    try { info = await resolveCol(type, id); } catch (e) { S.toast('Não consegui abrir a lista: ' + S.errMsg(e)); return; }
    var tracks = info.tracks.filter(function (t) { return t.kind === 'song'; });
    if (!tracks.length) { S.toast('Nada para baixar aqui.'); return; }
    var need = S.offlineEstimate(tracks), free = st.settings.limit ? st.settings.limit - usedBytes() : Infinity;
    if (need > free && !confirm('"' + info.name + '" precisa de cerca de ' + S.fmtBytes(need) + ', mas só restam ' + S.fmtBytes(Math.max(0, free)) +
      ' dentro do limite de ' + fmtLimit() + '.\n\nBaixar até onde couber? (Você pode aumentar o limite depois.)')) return;
    st.cols[key] = { type: type, id: id, name: info.name, artist: info.artist || '', trackIds: tracks.map(function (t) { return t.id; }), savedAt: Date.now() };
    tracks.forEach(function (t) { attach(key, t); });
    persist(); S.toast('Baixando "' + info.name + '" (' + tracks.length + ' faixas, ~' + S.fmtBytes(need) + ')'); paintSoon(); S.offlinePump();
  };
  S.offlineRemoveCollection = async function (key) {
    var c = st.cols[key]; if (!c) return;
    for (var i = 0; i < c.trackIds.length; i++) {
      var t = st.tracks[c.trackIds[i]]; if (!t) continue;
      t.cols = (t.cols || []).filter(function (k) { return k !== key; });
      if (!t.cols.length && !t.direct) await dropTrack(t.id);
    }
    delete st.cols[key];
    persist(); refreshDevice().then(paintSoon); paintSoon();
  };
  S.offlineColState = function (type, id) {
    var c = st.cols[colKey(type, id)]; if (!c) return { state: 'none' };
    var done = 0, bad = 0;
    c.trackIds.forEach(function (tid) { var t = st.tracks[tid]; if (isReady(t)) done++; else if (t && t.status === 'failed') bad++; });
    return { state: done === c.trackIds.length ? 'ready' : 'partial', done: done, total: c.trackIds.length, bad: bad, paused: !!st.run.blocked && !st.run.active };
  };
  // mantém os álbuns/playlists offline iguais aos do servidor (faixa nova entra, faixa removida sai)
  S.offlineSync = async function () {
    if (!S.online || !S.auth || !S.loaded) return;
    var keys = Object.keys(st.cols), changed = false;
    for (var i = 0; i < keys.length; i++) {
      var c = st.cols[keys[i]], info;
      if (!c) continue;
      try { info = await resolveCol(c.type, c.id); } catch (e) { continue; }
      if (c.type === 'album' && !info.tracks.length) continue;       // álbum sumiu da biblioteca: deixa como está
      if (info.name && info.name !== c.name) { c.name = info.name; changed = true; }
      var cur = {}; info.tracks.forEach(function (t) { if (t.kind === 'song') cur[t.id] = t; });
      for (var j = 0; j < c.trackIds.length; j++) {
        var tid = c.trackIds[j];
        if (!cur[tid]) {
          var t0 = st.tracks[tid];
          if (t0) { t0.cols = (t0.cols || []).filter(function (k) { return k !== keys[i]; }); if (!t0.cols.length && !t0.direct) await dropTrack(tid); }
          changed = true;
        }
      }
      var ids = Object.keys(cur);
      if (ids.length !== c.trackIds.length || ids.some(function (id) { return c.trackIds.indexOf(id) < 0; })) changed = true;
      c.trackIds = ids;
      ids.forEach(function (id) { attach(keys[i], cur[id]); });
    }
    if (changed) { persist(); paintSoon(); }
    if (queuedCount()) S.offlinePump();
  };

  S.offlineClear = async function () {
    await B.wipe();
    Object.keys(st.tracks).forEach(function (k) { delete st.tracks[k]; });
    st.cols = {}; st.covers = {}; st.queue = []; st.run.blocked = '';
    persist(); refreshDevice().then(paintSoon); paintSoon();
  };
  S.offlineCancelQueue = async function () {
    var ids = st.queue.slice();
    for (var i = 0; i < ids.length; i++) {
      var t = st.tracks[ids[i]]; if (!t) continue;
      (t.cols || []).forEach(function (k) { var c = st.cols[k]; if (c) c.trackIds = c.trackIds.filter(function (x) { return x !== t.id; }); });
      delete st.tracks[t.id];
    }
    Object.keys(st.cols).forEach(function (k) { if (!st.cols[k].trackIds.length) delete st.cols[k]; });
    st.queue = []; st.run.blocked = '';
    persist(); paintSoon();
  };

  // ---------------------------------------------------------------- telas ---
  function pctBar(p) { return '<div class="bar"><i style="width:' + Math.max(0, Math.min(100, p)) + '%"></i></div>'; }
  S.offlineButton = function (type, id) {
    return '<span class="off-slot" data-type="' + esc(type) + '" data-id="' + esc(id) + '">' + slotHtml(type, id) + '</span>';
  };
  function slotHtml(type, id) {
    var cs = S.offlineColState(type, id), key = esc(colKey(type, id));
    if (cs.state === 'none') return '<button class="btn" data-act="off-col" data-type="' + esc(type) + '" data-id="' + esc(id) + '">↓ Baixar offline</button>';
    if (cs.state === 'ready') return '<button class="btn green" data-act="off-col-del" data-key="' + key + '">✓ Offline · remover</button>';
    return '<button class="btn" data-act="off-col-del" data-key="' + key + '">' + (cs.paused ? '⏸ ' : '↓ ') + cs.done + '/' + cs.total + ' · remover</button>';
  }
  function colRow(c, key) {
    var cs = S.offlineColState(c.type, c.id), size = 0;
    c.trackIds.forEach(function (tid) { var t = st.tracks[tid]; if (isReady(t)) size += t.size || 0; });
    var sub = c.type === 'album' ? (c.artist ? esc(c.artist) + ' · ' : '') : '';
    var status = cs.state === 'ready' ? cs.total + ' faixas' : cs.done + ' de ' + cs.total + ' baixadas' + (cs.bad ? ' · ' + cs.bad + ' falharam' : '');
    var cover = c.type === 'album' ? S.coverUrl(c.id, 120) : '';
    var icon = cover ? '<span class="art r12 a44"><img src="' + esc(cover) + '" alt="" onerror="this.remove()"></span>'
      : '<span class="art r12 a44" style="background:linear-gradient(135deg,#4b2bd6,#3b8cff);display:flex;align-items:center;justify-content:center;color:#fff">' + (c.id === '__fav' ? '♥' : '♪') + '</span>';
    return '<div class="song" role="button" data-act="' + (c.type === 'album' ? 'album' : 'playlist') + '" data-id="' + esc(c.id) + '">' + icon +
      '<span class="grow"><div class="t trunc">' + esc(c.name) + '</div><div class="s trunc">' + sub + status + ' · ' + S.fmtBytes(size) + '</div></span>' +
      '<button class="icon-btn" data-act="off-col-del" data-key="' + esc(key) + '" aria-label="Remover do offline">✕</button></div>';
  }
  S.offlineScreen = function () {
    var used = usedBytes(), lim = st.settings.limit, over = lim && used > lim, r = st.run;
    var pct = lim ? Math.min(100, Math.round(used / lim * 100)) : (st.device && st.device.total ? Math.min(100, Math.round(used / st.device.total * 100)) : 0);
    var rd = ready(), colKeys = Object.keys(st.cols);
    var albums = colKeys.filter(function (k) { return st.cols[k].type === 'album'; });
    var pls = colKeys.filter(function (k) { return st.cols[k].type === 'playlist'; });
    var singles = rd.filter(function (t) { return t.direct && !(t.cols || []).length; });
    var failed = Object.keys(st.tracks).filter(function (id) { return st.tracks[id].status === 'failed'; });
    var h = '<div id="off-screen" class="stack">' +
      '<div class="card"><div class="row between mb8"><div class="h2">Offline neste aparelho</div><span class="small muted">' + S.fmtBytes(used) + (lim ? ' de ' + S.fmtBytes(lim) : '') + '</span></div>' +
      pctBar(pct) +
      '<div class="xs muted mt8">' + rd.length + ' faixas' + (st.device && st.device.free ? ' · ' + S.fmtBytes(st.device.free) + ' livres no aparelho' : '') +
      (over ? ' · <span style="color:var(--red)">acima do limite</span>' : '') + '</div>' +
      '<div class="row gap8 mt12" style="flex-wrap:wrap"><button class="btn sm" data-act="off-limit">Limite: ' + esc(fmtLimit()) + '</button>' +
      '<button class="btn sm" data-act="off-quality">Qualidade: ' + esc(qual().id === 'orig' ? 'original' : qual().kbps + ' kbps') + '</button>' +
      '<button class="btn sm" data-act="off-wifi">Só no Wi‑Fi: ' + (st.settings.wifiOnly ? 'sim' : 'não') + '</button></div></div>';
    if (queuedCount() || r.blocked || failed.length) {
      var total = r.total || queuedCount();
      h += '<div class="card"><div class="row between mb8"><div class="h2">' + (r.active ? 'Baixando…' : (r.blocked ? 'Pausado' : 'Na fila')) + '</div><span class="small muted">' + queuedCount() + ' faltam</span></div>' +
        (r.active ? pctBar(total ? (r.done + r.curPct) / total * 100 : 0) + '<div class="xs muted mt8 trunc">' + esc(r.cur || '') + '</div>' : '') +
        (r.blocked ? '<div class="small mt8" style="color:var(--amber)">' + esc(r.blocked) + '</div>' : '') +
        (failed.length ? '<div class="small mt8" style="color:var(--red)">' + failed.length + ' faixa(s) falharam.</div>' : '') +
        '<div class="row gap8 mt12"><button class="btn green sm" data-act="off-retry">' + (r.active ? 'Atualizar' : 'Tentar de novo') + '</button>' +
        '<button class="btn danger sm" data-act="off-cancel">Cancelar fila</button></div></div>';
    }
    if (pls.length) h += '<div><div class="h2 mb8">Playlists</div>' + pls.map(function (k) { return colRow(st.cols[k], k); }).join('') + '</div>';
    if (albums.length) h += '<div><div class="h2 mb8">Álbuns</div>' + albums.map(function (k) { return colRow(st.cols[k], k); }).join('') + '</div>';
    if (singles.length) h += '<div><div class="h2 mb8">Músicas avulsas</div>' + singles.map(function (t) {
      return '<div class="song" role="button" data-act="off-play" data-id="' + esc(t.id) + '"><span class="art r12 a44"><img src="' + esc(S.coverUrl(t.albumId || ('mf-' + t.id), 120)) + '" alt="" onerror="this.remove()"></span>' +
        '<span class="grow"><div class="t trunc">' + esc(t.title) + '</div><div class="s trunc">' + esc(t.artist) + ' · ' + S.fmtBytes(t.size || 0) + '</div></span>' +
        '<button class="icon-btn" data-act="off-track-del" data-id="' + esc(t.id) + '" aria-label="Remover do offline">✕</button></div>';
    }).join('') + '</div>';
    if (!colKeys.length && !singles.length && !queuedCount()) {
      h += '<div class="empty">Nada offline ainda.<br>Abra um álbum ou uma playlist e toque em "Baixar offline", ou use ⋮ em uma música.</div>';
    }
    if (rd.length || colKeys.length) h += '<button class="btn danger" style="width:100%" data-act="off-wipe">Apagar tudo do offline</button>';
    return h + '</div>';
  };
  S.offlineSummary = function () { return rd2() + ' faixas · ' + S.fmtBytes(usedBytes()) + ' de ' + fmtLimit(); };
  function rd2() { return ready().length; }

  var paintT = null;
  function paintSoon() {
    if (paintT) return;
    paintT = setTimeout(function () {
      paintT = null;
      var scr = document.getElementById('off-screen');
      if (scr && scr.parentNode) { var tmp = document.createElement('div'); tmp.innerHTML = S.offlineScreen(); scr.replaceWith(tmp.firstChild); }
      Array.prototype.forEach.call(document.querySelectorAll('.off-slot'), function (el) { el.innerHTML = slotHtml(el.dataset.type, el.dataset.id); });
      var car = document.getElementById('off-summary'); if (car) car.textContent = S.offlineSummary();
    }, 250);
  }
  S.offlinePaint = paintSoon;

  // ---------------------------------------------------------------- ações (ligadas em views.js) ---
  function closeSheet() { if (S.closeSheet) S.closeSheet(false); }
  S.offActions = {
    'off-col': function (d) { S.offlineAddCollection(d.type, d.id); },
    'off-col-del': function (d) {
      var c = st.cols[d.key]; if (!c) return;
      if (confirm('Remover "' + c.name + '" do offline? As músicas saem do aparelho (continuam no servidor).')) S.offlineRemoveCollection(d.key).then(function () { S.toast('Removido do offline'); });
    },
    'off-track-del': function (d) { S.offlineRemove(d.id); },
    'off-play': function (d) {
      var list = ready().filter(function (x) { return x.direct && !(x.cols || []).length; });
      var i = list.findIndex(function (x) { return x.id === d.id; });
      if (i >= 0) S.playList(list, i);
    },
    'off-wipe': function () { if (confirm('Apagar TUDO que está salvo offline neste aparelho?')) S.offlineClear().then(function () { S.toast('Offline apagado'); }); },
    'off-retry': function () {
      Object.keys(st.tracks).forEach(function (id) { var t = st.tracks[id]; if (t.status === 'failed') { t.status = 'queued'; t.fail = 0; if (st.queue.indexOf(id) < 0) st.queue.push(id); } });
      persist(); S.offlinePump();
    },
    'off-cancel': function () { if (confirm('Cancelar os downloads que faltam?')) S.offlineCancelQueue(); },
    'off-wifi': function () { st.settings.wifiOnly = !st.settings.wifiOnly; persist(); paintSoon(); if (queuedCount()) S.offlinePump(); },
    'off-limit': function () {
      refreshDevice().then(function () {
        S.openSheet('<div class="h2">Limite de espaço offline</div>' +
          '<div class="xs muted mb8">Quanto do aparelho o Guitarr pode usar para músicas offline. Usado agora: ' + S.fmtBytes(usedBytes()) +
          (st.device && st.device.free ? ' · livre no aparelho: ' + S.fmtBytes(st.device.free) : '') + '.</div>' +
          '<div class="chips" style="flex-wrap:wrap;gap:8px">' + LIMITS_GB.map(function (g) {
            return '<button class="chip' + (st.settings.limit === g * 1e9 ? ' on' : '') + '" data-act="off-limit-set" data-gb="' + g + '">' + g + ' GB</button>';
          }).join('') + '<button class="chip' + (!st.settings.limit ? ' on' : '') + '" data-act="off-limit-set" data-gb="0">Sem limite</button></div>' +
          '<label class="field mt12"><span>Outro valor (GB)</span><input class="input plain" id="off-lim-custom" type="number" min="0.1" step="0.5" inputmode="decimal" placeholder="ex.: 3.5"></label>' +
          '<div class="row gap8 mt16"><button class="btn green grow" data-act="off-limit-custom">Aplicar</button><button class="btn" data-act="sheet-close-btn">Fechar</button></div>');
      });
    },
    'off-limit-set': function (d) { setLimit(Number(d.gb) * 1e9); },
    'off-limit-custom': function () {
      var v = parseFloat(String((document.getElementById('off-lim-custom') || {}).value || '').replace(',', '.'));
      if (!(v > 0)) { S.toast('Digite um valor em GB, por exemplo 3.5'); return; }
      setLimit(Math.round(v * 1e9));
    },
    'off-quality': function () {
      S.openSheet('<div class="h2">Qualidade dos downloads</div><div class="xs muted mb8">Vale para os próximos downloads. O que já está salvo não muda.</div>' +
        QUALITIES.map(function (q) {
          return '<button class="opt" data-act="off-quality-set" data-q="' + q.id + '"><span class="ic" style="color:var(--green)">' + (st.settings.quality === q.id ? '●' : '○') + '</span>' +
            '<span style="text-align:left"><div>' + q.label + '</div><div class="xs muted">' + q.hint + '</div></span></button>';
        }).join('') + '<button class="btn" style="width:100%;margin-top:8px" data-act="sheet-close-btn">Fechar</button>');
    },
    'off-quality-set': function (d) { st.settings.quality = d.q; persist(); closeSheet(); paintSoon(); S.toast('Qualidade: ' + qual().label); },
    'off-open': function () { S.libSeg = 'offline'; S.go('library'); }
  };
  function setLimit(bytes) {
    st.settings.limit = bytes > 0 ? bytes : 0; persist(); closeSheet(); paintSoon();
    var used = usedBytes();
    if (bytes > 0 && used > bytes) S.toast('Você já usa ' + S.fmtBytes(used) + ' — apague itens para ficar abaixo do limite.');
    else S.toast(bytes > 0 ? 'Limite: ' + S.fmtBytes(bytes) : 'Sem limite de espaço');
    if (queuedCount()) S.offlinePump();
  }

  // ---------------------------------------------------------------- modo sem rede ---
  S.offlineLibraryData = function () { // álbuns/playlists para a biblioteca quando não há rede
    var tracks = ready(), albums = [], seen = {}, playlists = [];
    Object.keys(st.cols).forEach(function (k) {
      var c = st.cols[k];
      if (c.type === 'album' && !seen[c.id]) { seen[c.id] = 1; albums.push({ id: c.id, name: c.name, artist: c.artist, artistId: '', year: 0, songCount: c.trackIds.length, createdAt: '' }); }
      if (c.type === 'playlist') playlists.push({ id: c.id, name: c.name, songCount: c.trackIds.length, ids: c.trackIds });
    });
    tracks.forEach(function (t) { if (t.albumId && !seen[t.albumId]) { seen[t.albumId] = 1; albums.push({ id: t.albumId, name: t.album, artist: t.artist, artistId: t.artistId, year: t.year, songCount: 1, createdAt: '' }); } });
    return { tracks: tracks, albums: albums, playlists: playlists };
  };

  window.addEventListener('online', function () { if (queuedCount()) setTimeout(S.offlinePump, 1500); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && queuedCount() && !pumping) S.offlinePump(); });
})();
