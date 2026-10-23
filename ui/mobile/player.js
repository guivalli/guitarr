'use strict';
(function () {
  var S = window.S, $ = S.$, esc = S.esc;
  var audio = new Audio();
  audio.preload = 'auto';
  window.__seerAudio = audio;
  var objectUrl = null, loadToken = 0, scrobbled = false, lastSaveAt = 0, lastSig = '', saveTimer = null, switching = false;

  // ----------------------------------------------------------------- faixas ---
  var LOSSLESS = { FLAC: 1, ALAC: 1, WAV: 1, AIFF: 1, APE: 1, WV: 1, DSF: 1, DFF: 1 };
  // Converte um registro da API nativa (/api/song) ou do Subsonic (entry) em faixa do app.
  S.mkTrack = function (s) {
    var suf = String(s.suffix || '').toUpperCase();
    return {
      id: s.id, title: s.title || '', artist: s.artist || s.albumArtist || '', album: s.album || '',
      albumId: s.albumId || '', artistId: s.artistId || s.albumArtistId || '',
      duration: s.duration || 0, suffix: suf, bitRate: s.bitRate || 0, lossless: !!LOSSLESS[suf], size: s.size || 0,
      year: s.year || 0, track: s.trackNumber || s.track || 0, disc: s.discNumber || 1, genre: s.genre || '',
      starred: !!(s.starred || s.starredAt), path: s.path || '', kind: 'song',
      plays: s.playCount || 0, rating: s.rating || s.userRating || 0, bpm: s.bpm || 0, added: s.createdAt || s.created || '',
      lastPlayed: s.playDate || s.played || '',
      genres: (s.genres || []).map(function (g) { return g.name; }).filter(Boolean).join(' / ') || s.genre || ''
    };
  };
  S.quality = function (t) { return t.lossless ? t.suffix : ((t.suffix || '') + ' ' + (t.bitRate || '')).trim(); };
  S.cur = function () { return S.q[S.qi] || null; };
  S.isFav = function (t) { return !!(t && (S.favs[t.id] || (t.kind === 'song' && t.starred && S.favs[t.id] !== false))); };

  // O offline (armazém, fila, limite) vive em offline.js: S.offlineHas / S.offlineSrc.
  function revoke(u) { if (u && /^blob:/.test(u)) { try { URL.revokeObjectURL(u); } catch (e) {} } }

  // ------------------------------------------------------------- reprodução ---
  function setMediaSession(t) {
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined' || !t) return;
    try {
      var art = t.cover ? t.cover : (t.kind === 'song' && S.auth ? S.coverUrl(t.albumId || ('mf-' + t.id), 512) : '');
      navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: t.album || '',
        artwork: art ? [{ src: new URL(art, location.href).href, sizes: '512x512', type: 'image/jpeg' }] : [] });
    } catch (e) {}
  }
  function sourceFor(t) {
    if (t.kind === 'episode') return S.episodeUrl(t.id);
    return S.streamUrl(t.id);
  }
  // Carrega a faixa atual no <audio>. play=false só prepara (restaurar sessão, fila nova pausada).
  S.load = async function (play, startAt) {
    var t = S.cur(), my = ++loadToken;
    if (!t) { audio.pause(); S.paint(); return; }
    scrobbled = false; S.lyrics = null;
    var src = null;
    if (t.kind === 'song' && S.offlineHas(t.id)) src = await S.offlineSrc(t.id);
    if (my !== loadToken) { revoke(src); return; }
    if (objectUrl) { revoke(objectUrl); objectUrl = null; }
    if (src) objectUrl = src;
    switching = true; setTimeout(function () { switching = false; }, 500);
    audio.src = src || sourceFor(t);
    S.pos = startAt || 0; S.dur = t.duration || 0;
    if (startAt > 1) { try { audio.currentTime = startAt; } catch (e) {} }
    setMediaSession(t);
    S.playing = !!play;
    if (play) {
      var p = audio.play();
      if (p && p.catch) p.catch(function (err) {
        if (err && err.name === 'AbortError') return;
        S.playing = false; S.paint();
        S.toast(err && err.name === 'NotAllowedError' ? 'Toque em ▶ para iniciar o áudio' : 'Não foi possível tocar esta faixa');
      });
      if (t.kind === 'song') S.subsonic('scrobble', { id: t.id, submission: 'false' }).catch(function () {});
    } else audio.pause();
    S.paint(); S.paintRows(); S.saveLater();
    if (t.kind === 'song') S.loadLyrics(t);
  };

  S.playList = function (tracks, index, opt) {
    opt = opt || {};
    if (!tracks || !tracks.length) return;
    S.orig = null;
    S.q = tracks.slice();
    S.qi = Math.max(0, Math.min(index || 0, S.q.length - 1));
    if (opt.shuffle) {
      var first = S.q[S.qi], rest = S.q.filter(function (x, i) { return i !== S.qi; });
      shuffleArr(rest);
      S.orig = S.q.slice(); S.q = [first].concat(rest); S.qi = 0; S.shuffle = true;
    } else if (S.shuffle) {
      var cur = S.q[S.qi], others = S.q.filter(function (x, i) { return i !== S.qi; });
      shuffleArr(others);
      S.orig = S.q.slice(); S.q = [cur].concat(others); S.qi = 0;
    }
    S.load(true, 0);
  };
  function shuffleArr(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } }
  S.toggleShuffle = function () {
    var cur = S.cur();
    if (!S.shuffle) {
      S.shuffle = true;
      if (S.q.length > 1) {
        var rest = S.q.filter(function (x, i) { return i !== S.qi; });
        shuffleArr(rest); S.orig = S.q.slice(); S.q = [cur].concat(rest); S.qi = 0;
      }
    } else {
      S.shuffle = false;
      if (S.orig) { S.q = S.orig; S.orig = null; var i = S.q.findIndex(function (x) { return cur && x.id === cur.id; }); S.qi = i >= 0 ? i : 0; }
    }
    S.paint(); S.saveLater();
  };
  S.cycleRepeat = function () { S.repeat = S.repeat === 'off' ? 'all' : S.repeat === 'all' ? 'one' : 'off'; S.paint(); S.saveLater(); };
  S.playNext = function (t) { if (!S.q.length) { S.playList([t], 0); return; } S.q.splice(S.qi + 1, 0, t); S.toast('Toca a seguir'); S.saveLater(); };
  S.enqueue = function (t) { if (!S.q.length) { S.playList([t], 0); return; } S.q.push(t); S.toast('Adicionada à fila'); S.saveLater(); };

  S.togglePlay = function () {
    if (!S.cur()) {
      if (S.tracks.length) S.playList(S.visibleSongs ? S.visibleSongs() : S.tracks, 0, { shuffle: true });
      return;
    }
    if (S.playing) { audio.pause(); S.playing = false; S.paint(); S.paintRows(); S.saveLater(); return; }
    S.playing = true;
    if (!audio.src) { S.load(true, S.pos); return; }
    var p = audio.play();
    if (p && p.catch) p.catch(function () { S.playing = false; S.paint(); });
    S.paint(); S.paintRows(); S.saveLater();
  };
  S.next = function (auto) {
    if (!S.q.length) return;
    if (auto && S.repeat === 'one') { audio.currentTime = 0; audio.play().catch(function () {}); return; }
    if (S.qi + 1 < S.q.length) { S.qi++; S.load(true, 0); return; }
    if (S.repeat === 'all' || !auto) { S.qi = 0; S.load(true, 0); return; }
    S.playing = false; audio.pause(); S.paint(); S.paintRows();
  };
  S.prev = function () {
    if (!S.q.length) return;
    if (audio.currentTime > 3 || S.qi === 0) { audio.currentTime = 0; S.pos = 0; S.paintProgress(); return; }
    S.qi--; S.load(true, 0);
  };
  S.seek = function (sec) { try { audio.currentTime = sec; S.pos = sec; S.paintProgress(); S.saveLater(); } catch (e) {} };
  S.skipTo = function (i) { if (i >= 0 && i < S.q.length) { S.qi = i; S.load(true, 0); } };

  audio.addEventListener('timeupdate', function () {
    S.pos = audio.currentTime || 0;
    if (audio.duration && isFinite(audio.duration)) S.dur = audio.duration;
    var t = S.cur();
    S.paintProgress();
    if (t && t.kind === 'song' && !scrobbled && S.dur && S.pos > Math.min(240, S.dur * 0.5)) {
      scrobbled = true; S.subsonic('scrobble', { id: t.id, submission: 'true' }).catch(function () {});
    }
    if (Date.now() - lastSaveAt > 5000) S.save(false);
  });
  audio.addEventListener('loadedmetadata', function () { if (audio.duration && isFinite(audio.duration)) { S.dur = audio.duration; S.paintProgress(); } });
  audio.addEventListener('ended', function () { S.next(true); });
  audio.addEventListener('pause', function () { if (!audio.ended && !switching && S.playing && audio.readyState > 0) { /* pausa externa (fone, sistema) */ S.playing = false; S.paint(); S.paintRows(); S.saveLater(); } });
  audio.addEventListener('play', function () { if (!S.playing) { S.playing = true; S.paint(); S.paintRows(); S.saveLater(); } });
  audio.addEventListener('error', function () {
    if (!audio.src || !S.cur()) return;
    S.toast('Erro ao carregar o áudio');
  });
  if ('mediaSession' in navigator) {
    var ms = function (a, f) { try { navigator.mediaSession.setActionHandler(a, f); } catch (e) {} };
    ms('play', function () { if (!S.playing) S.togglePlay(); });
    ms('pause', function () { if (S.playing) S.togglePlay(); });
    ms('previoustrack', function () { S.prev(); });
    ms('nexttrack', function () { S.next(false); });
    ms('seekto', function (d) { if (d && d.seekTime != null) S.seek(d.seekTime); });
  }

  // --------------------------------------------------------------- favoritos ---
  S.toggleFav = async function (t) {
    if (!t || t.kind !== 'song') return;
    var on = !S.isFav(t);
    S.favs[t.id] = on; t.starred = on;
    var real = S.byId[t.id]; if (real) real.starred = on;
    S.paint(); S.paintRows();
    try { await S.subsonic(on ? 'star' : 'unstar', { id: t.id }); S.toast(on ? 'Adicionada às Curtidas' : 'Removida das Curtidas'); }
    catch (e) { S.favs[t.id] = !on; t.starred = !on; if (real) real.starred = !on; S.paint(); S.paintRows(); S.toast('Erro: ' + S.errMsg(e)); }
  };

  // ------------------------------------------------------------------ letras ---
  // Como no site: primeiro a letra do servidor (OpenSubsonic getLyricsBySongId, .lrc/.txt ao lado do
  // arquivo), e se ela não for sincronizada, o LRCLIB (/api/seer/lyrics/{id}/lrclib). Cache por sessão.
  var lyricsCache = {};
  function parseLRC(text) {
    var lines = [], offset = 0;
    String(text || '').split(/\r?\n/).forEach(function (raw) {
      var off = raw.match(/^\[offset:\s*([+-]?\d+)\]/i);
      if (off) { offset = parseInt(off[1], 10) / 1000; return; }
      var re = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g, m, times = [], last = 0;
      while ((m = re.exec(raw))) { times.push(parseInt(m[1], 10) * 60 + parseFloat(m[2].replace(':', '.'))); last = re.lastIndex; }
      var txt = raw.slice(last).replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, '').trim();
      times.forEach(function (t) { lines.push({ t: t, v: txt }); });
    });
    lines.forEach(function (l) { l.t = Math.max(0, l.t - offset); });
    return lines.sort(function (a, b) { return a.t - b.t; });
  }
  S.parseLRC = parseLRC;
  function pickLrclib(cands, sec) {
    var plain = null;
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      if (c.instrumental) continue;
      var near = !sec || Math.abs((c.duration || 0) - sec) <= 3;
      if (c.synced && near) return c;
      if (!plain && near && c.plain) plain = c;
    }
    return plain;
  }
  async function fetchLyrics(t) {
    if (lyricsCache[t.id]) return lyricsCache[t.id];
    var out = { synced: false, lines: [], source: '' };
    try {
      var d = await S.subsonic('getLyricsBySongId', { id: t.id });
      var list = (d.lyricsList && d.lyricsList.structuredLyrics) || [];
      var sl = list.find(function (x) { return x.synced; }) || list[0];
      if (sl && sl.line && sl.line.length) {
        out = { synced: !!sl.synced, source: 'arquivo', lines: sl.line.map(function (l) { return { t: sl.synced ? Math.max(0, (l.start || 0) / 1000 - (sl.offset || 0) / 1000) : -1, v: l.value || '' }; }) };
      }
    } catch (e) {}
    if (!out.synced && S.online) {
      try {
        var c = pickLrclib((await S.apiJson('/api/seer/lyrics/' + encodeURIComponent(t.id) + '/lrclib')) || [], t.duration);
        if (c && (c.synced || !out.lines.length)) {
          out = c.synced ? { synced: true, lines: parseLRC(c.synced), source: 'LRCLIB' }
            : { synced: false, lines: String(c.plain || '').split(/\r?\n/).map(function (v) { return { t: -1, v: v.trim() }; }), source: 'LRCLIB' };
        }
      } catch (e) {}
    }
    lyricsCache[t.id] = out;
    return out;
  }
  S.loadLyrics = async function (t) {
    var id = t.id;
    S.lyrics = null; S.paintLyrics();
    var ly = await fetchLyrics(t);
    if (S.cur() && S.cur().id === id) { S.lyrics = ly; S.paintLyrics(); }
  };

  // ------------------------------------------------- sessão (continuar de onde parou) ---
  // /api/seer/state guarda por usuário: "playback" (faixa, posição, fila — compartilhado com o site)
  // e "mobile" (aba e telas abertas). Abrir em outro aparelho ou recarregar retoma de onde estava.
  function snapshot() {
    var t = S.cur();
    var snap = { mobile: { tab: S.tab, pages: S.pages.slice(0, 6), filter: S.filter, libSeg: S.libSeg } };
    if (t && t.kind === 'song') {
      snap.playback = { trackId: t.id, pos: Math.round(S.pos || 0), shuffle: !!S.shuffle, repeat: S.repeat !== 'off',
        repeatMode: S.repeat, queue: S.q.filter(function (x) { return x.kind === 'song'; }).map(function (x) { return x.id; }).slice(0, 500), device: 'mobile' };
    }
    return snap;
  }
  S.save = function (force) {
    if (!S.auth || !S.sessReady) return;
    var snap = snapshot();
    var pos = snap.playback ? snap.playback.pos : 0;
    var sig = JSON.stringify(snap, function (k, v) { return k === 'pos' ? undefined : v; });
    if (!force && sig === lastSig && Math.abs(pos - (S._lastPos || 0)) < 5) return;
    lastSig = sig; S._lastPos = pos; lastSaveAt = Date.now();
    S.api('/api/seer/state', { method: 'PUT', json: snap, keepalive: true }).catch(function () {});
  };
  S.saveLater = function () {
    if (saveTimer) return;
    saveTimer = setTimeout(function () { saveTimer = null; S.save(false); }, 1500);
  };
  S.restore = async function () {
    var st = null;
    try { st = await S.apiJson('/api/seer/state'); } catch (e) {}
    S.sessReady = true;
    if (!st) return;
    var m = st.mobile, pb = st.playback;
    if (st.prefs && window.seerLangFromAccount && window.seerLangFromAccount(st.prefs.lang)) return;
    if (st.theme && st.theme.name && S.setTheme && st.theme.name !== S.ls('seer_theme')) S.setTheme(st.theme.name, true);
    if (m && !location.hash) {
      if (['home', 'seer', 'library', 'podcasts', 'car'].indexOf(m.tab) >= 0) S.tab = m.tab;
      if (m.filter) S.filter = m.filter;
      if (m.libSeg) S.libSeg = m.libSeg;
      S.pages = (m.pages || []).filter(function (p) { return p && p.type && p.id; });
    }
    if (pb && pb.trackId && S.byId[pb.trackId]) {
      var ids = (pb.queue && pb.queue.length ? pb.queue : [pb.trackId]);
      var q = ids.map(function (id) { return S.byId[id]; }).filter(Boolean);
      var qi = q.findIndex(function (t) { return t.id === pb.trackId; });
      if (qi < 0) { q = [S.byId[pb.trackId]]; qi = 0; }
      S.q = q; S.qi = qi; S.shuffle = !!pb.shuffle; S.repeat = pb.repeatMode || (pb.repeat ? 'all' : 'off');
      await S.load(false, Math.max(0, Number(pb.pos) || 0));
    }
  };
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') S.save(true); });
  window.addEventListener('pagehide', function () { S.save(true); });
})();
