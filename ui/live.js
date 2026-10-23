/* =============================================================================
 * LIVE BACKEND LAYER — liga o visual "Guitarr" ao servidor Guitarr real.
 * Roda depois do script do mock e troca dados/áudio/handlers por chamadas reais:
 *   - /auth/login            -> sessão (token JWT + salt/token Subsonic)
 *   - /api/song|album|artist|playlist|radio|share  (API nativa, paginada)
 *   - /rest/stream|getCoverArt|star|unstar|scrobble (Subsonic)
 *   - /api/seer/*            -> catálogo, pedidos, storage, duplicatas, imports, podcasts
 * ============================================================================= */
(function () {
  'use strict';

  var AUTH_KEY = 'nd_seer_pro_auth';
  var auth = null;
  var audio = new Audio();
  audio.preload = 'auto';
  window.__seerAudio = audio; // útil para depurar no console
  var queue = null;          // índices de TRACKS da fila atual (null = biblioteca toda)
  var loadedKey = null;      // o que está carregado no <audio>
  var scrobbled = false;
  var ext = null;            // áudio fora da biblioteca: {title, subtitle, cover, live}
  var libraryLoaded = false;
  var podcastEpisodes = 0;   // episódios baixados que ficam fora de Músicas/Álbuns/Artistas
  var reloadTimer = null;
  var switching = false;     // true logo após trocar o src do <audio>

  // ---------------------------------------------------------------- helpers ---
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function unesc(s) {
    return String(s == null ? '' : s).replace(/&quot;/g, '"').replace(/&gt;/g, '>')
      .replace(/&lt;/g, '<').replace(/&amp;/g, '&');
  }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function fmtDur(sec) {
    var s = Math.max(0, Math.round(sec || 0));
    return pad2(Math.floor(s / 60)) + ':' + pad2(s % 60);
  }
  function fmtBytes(b) {
    b = Number(b) || 0;
    if (b >= 1e12) return (b / 1e12).toFixed(2) + ' TB';
    if (b >= 1e9) return (b / 1e9).toFixed(1) + ' GB';
    if (b >= 1e6) return (b / 1e6).toFixed(1) + ' MB';
    return Math.round(b / 1e3) + ' KB';
  }
  function hexToRgba(hex, a) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return undefined;
    var n = parseInt(m[1], 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  function $(id) { return document.getElementById(id); }
  function setText(id, txt) { var el = $(id); if (el) el.textContent = txt; }
  function toast(m) { if (window.showToast) window.showToast(m); }
  function errMsg(e) { return (e && e.message) ? e.message : 'erro desconhecido'; }
  function showModal(id) { var m = $(id); if (m) { m.classList.remove('hidden'); m.classList.add('flex'); } }

  // ------------------------------------------------------------------- auth ---
  function loadAuth() {
    try { var a = JSON.parse(localStorage.getItem(AUTH_KEY)); if (a && a.token && a.salt) auth = a; } catch (e) {}
  }
  function saveAuth() { try { localStorage.setItem(AUTH_KEY, JSON.stringify(auth)); } catch (e) {} }
  function subQuery() {
    return 'u=' + encodeURIComponent(auth.username) + '&t=' + auth.subToken + '&s=' + auth.salt +
      '&v=1.16.1&c=SeerPro';
  }
  var coverBust = {}; // álbum -> carimbo: força o navegador a buscar a capa nova depois de trocá-la
  function coverUrl(id, size) {
    return '/rest/getCoverArt?id=' + encodeURIComponent(id) + '&size=' + size + '&' + subQuery() + (coverBust[id] ? '&_=' + coverBust[id] : '');
  }
  function streamUrl(id) { return '/rest/stream?id=' + encodeURIComponent(id) + '&' + subQuery(); }

  async function doLogin(username, password) {
    var r = await fetch('/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username, password: password })
    });
    if (!r.ok) throw new Error(r.status === 401 ? 'Usuário ou senha incorretos' : 'Falha no login (' + r.status + ')');
    var d = await r.json();
    auth = { token: d.token, username: d.username, name: d.name || d.username, isAdmin: !!d.isAdmin,
      salt: d.subsonicSalt, subToken: d.subsonicToken, id: d.id };
    saveAuth();
  }

  function logout() {
    auth = null;
    try { localStorage.removeItem(AUTH_KEY); } catch (e) {}
    audio.pause();
    state.isPlaying = false;
    sess.ready = false; sess.restored = false;
    showLogin('');
  }

  // Primeiro acesso: o servidor põe firstTime=true na configuração da página enquanto não há nenhum usuário.
  var firstDone = false;
  function appCfg() {
    try { var c = JSON.parse(document.querySelector('meta[name="guitarr-config"]').getAttribute('content')); return c && typeof c === 'object' ? c : {}; }
    catch (e) { return {}; }
  }

  function showLogin(msg) {
    var el = $('seer-login');
    var first = !firstDone && !!appCfg().firstTime;
    if (!el) {
      el = document.createElement('div');
      el.id = 'seer-login';
      el.className = 'fixed inset-0 z-[100] bg-black/90 backdrop-blur-md flex items-center justify-center p-4';
      el.innerHTML =
        '<form id="seer-login-form" class="bg-[#1b1b22] border border-white/10 rounded-2xl max-w-sm w-full p-7 shadow-2xl space-y-4">' +
        '<div class="flex flex-col items-center gap-2 pb-1"><img src="{{LOGO_MARK}}" alt="Guitarr" class="w-20 h-20" />' +
        '<div class="font-display font-extrabold text-xl text-[#3b8cff] leading-none">Guit<span class="text-white">arr</span></div>' +
        '<div class="text-xs text-[#a7a7b0] text-center">' + (first ? 'Crie a conta de administrador. Ela controla o servidor.' : 'Entre com sua conta') + '</div></div>' +
        '<div><label class="block text-xs font-bold text-[#a7a7b0] mb-1">Usuário</label>' +
        '<input id="seer-login-user" autocomplete="username" required class="w-full px-3.5 py-2.5 rounded-xl bg-black/50 border border-white/15 text-sm text-white focus:border-[#3b8cff] focus:outline-none" /></div>' +
        '<div><label class="block text-xs font-bold text-[#a7a7b0] mb-1">Senha</label>' +
        '<input id="seer-login-pass" type="password" autocomplete="' + (first ? 'new-password' : 'current-password') + '" required class="w-full px-3.5 py-2.5 rounded-xl bg-black/50 border border-white/15 text-sm text-white focus:border-[#3b8cff] focus:outline-none" /></div>' +
        (first ? '<div><label class="block text-xs font-bold text-[#a7a7b0] mb-1">Confirmar senha</label>' +
        '<input id="seer-login-pass2" type="password" autocomplete="new-password" required class="w-full px-3.5 py-2.5 rounded-xl bg-black/50 border border-white/15 text-sm text-white focus:border-[#3b8cff] focus:outline-none" /></div>' : '') +
        '<div id="seer-login-err" class="text-xs text-red-400 min-h-[1rem]"></div>' +
        '<button type="submit" class="w-full py-2.5 rounded-full bg-[#3b8cff] hover:bg-[#5aa0ff] text-black font-extrabold text-sm transition">' + (first ? 'Criar conta' : 'Entrar') + '</button>' +
        '<div class="flex gap-1 pt-1">' + window.seerLangChips() + '</div>' +
        '</form>';
      document.body.appendChild(el);
      $('seer-login-form').addEventListener('submit', async function (ev) {
        ev.preventDefault();
        var btn = ev.target.querySelector('button[type=submit]');
        btn.disabled = true;
        setText('seer-login-err', '');
        try {
          var lu = $('seer-login-user').value.trim(), lp = $('seer-login-pass').value;
          if (first) {
            if (lp !== $('seer-login-pass2').value) throw new Error('As senhas não conferem');
            if (lp.length < 6) throw new Error('Use uma senha com pelo menos 6 caracteres');
            var cr = await fetch('/auth/createAdmin', { method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ username: lu, password: lp }) });
            if (!cr.ok) throw new Error('Não foi possível criar a conta (' + cr.status + ')');
            firstDone = true;
          }
          await doLogin(lu, lp);
          $('seer-login-pass').value = '';
          if (first) el.remove(); else el.classList.add('hidden');
          boot();
        } catch (e) {
          setText('seer-login-err', errMsg(e));
        } finally { btn.disabled = false; }
      });
    }
    el.classList.remove('hidden');
    setText('seer-login-err', msg || '');
    var u = $('seer-login-user'); if (u) u.focus();
  }

  // -------------------------------------------------------------------- api ---
  async function api(path, opt) {
    opt = opt || {};
    var h = { 'x-nd-authorization': 'Bearer ' + auth.token };
    var body;
    if (opt.json !== undefined) { h['Content-Type'] = 'application/json'; body = JSON.stringify(opt.json); }
    else if (opt.raw !== undefined) { h['Content-Type'] = opt.raw.type || 'application/octet-stream'; body = opt.raw; }
    else if (opt.form !== undefined) body = opt.form; // FormData: o navegador põe o boundary
    var res = await fetch(path, { method: opt.method || 'GET', headers: h, body: body });
    var nt = res.headers.get('x-nd-authorization');
    if (nt && nt !== auth.token) { auth.token = nt; saveAuth(); }
    if (res.status === 401) { showLogin('Sessão expirada. Entre novamente.'); throw new Error('Não autorizado'); }
    if (!res.ok) {
      var txt = '';
      try { txt = (await res.text()).trim(); } catch (e) {}
      var err = new Error(txt || ('HTTP ' + res.status));
      err.status = res.status;
      throw err;
    }
    return res;
  }
  async function apiJson(path, opt) {
    var res = await api(path, opt);
    if (res.status === 204) return null;
    return res.json();
  }
  async function fetchAll(resource, sort) {
    var out = [], PAGE = 500, start = 0, total = Infinity;
    while (start < total) {
      var res = await api('/api/' + resource + '?_start=' + start + '&_end=' + (start + PAGE) +
        '&_sort=' + sort + '&_order=ASC');
      var arr = await res.json();
      var hdr = parseInt(res.headers.get('x-total-count') || '', 10);
      total = isNaN(hdr) ? (arr.length < PAGE ? start + arr.length : Infinity) : hdr;
      for (var i = 0; i < arr.length; i++) out.push(arr[i]);
      if (!arr.length) break;
      start += PAGE;
    }
    return out;
  }
  async function subsonic(method, params) {
    var q = Object.keys(params || {}).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
    var r = await fetch('/rest/' + method + '?' + q + '&f=json&' + subQuery());
    var d = (await r.json())['subsonic-response'];
    if (!d || d.status !== 'ok') throw new Error((d && d.error && d.error.message) || 'erro Subsonic');
    return d;
  }

  // ------------------------------------------------------- library -> arrays ---
  var FAV_ID = '__favorites';
  var FAV_COVER = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#4b2bd6"/><stop offset="1" stop-color="#3b8cff"/></linearGradient></defs>' +
    '<rect width="100" height="100" fill="url(#g)"/><path fill="#fff" d="M50 76 28 54a13 13 0 0 1 18-19l4 4 4-4a13 13 0 0 1 18 19z"/></svg>');

  // mantém a playlist "Músicas Curtidas" igual às faixas com coração (índices + contagem + sidebar)
  function syncFavPlaylist(skipRender) {
    var pl = PLAYLISTS.find(function (p) { return p.id === FAV_ID; });
    if (!pl) return;
    pl.trackIdx = [];
    TRACKS.forEach(function (t, i) { if (t.fav) pl.trackIdx.push(i); });
    pl.count = pl.trackIdx.length;
    if (!skipRender) renderSidebarPlaylists();
  }

  var LOSSLESS = { FLAC: 1, ALAC: 1, WAV: 1, AIFF: 1, APE: 1, WV: 1, DSF: 1, DFF: 1 };

  function byDiscTrack(a, b) {
    return (a.disc - b.disc) || (a.num - b.num) || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0);
  }
  window.byDiscTrack = byDiscTrack;

  async function loadLibrary() {
    var r = await Promise.all([
      fetchAll('song', 'title'), fetchAll('album', 'name'), fetchAll('artist', 'name'),
      apiJson('/api/playlist?_start=0&_end=200&_sort=name&_order=ASC').catch(function () { return []; })
    ]);
    var songs = r[0], albums = r[1], artists = r[2], pls = r[3] || [];
    // O admin recebe também os registros de arquivos que não existem mais (missing): editar ou tocar um
    // deles dá "not found". Ficam fora da biblioteca.
    songs = songs.filter(function (s) { return !s.missing; });
    albums = albums.filter(function (a) { return !a.missing; });
    artists = artists.filter(function (a) { return !a.missing; });

    // Episódios baixados ficam em .../Podcasts/<canal>/ dentro da biblioteca; não são música: ficam
    // só na aba Podcasts. Um "álbum" ou "artista" feito só de episódios também sai das listas.
    var podAlbum = {}, musicAlbum = {}, podArtist = {}, musicArtist = {};
    songs.forEach(function (s) {
      var isPod = /(^|\/)podcasts\//i.test(s.path || '');
      s._pod = isPod;
      (isPod ? podAlbum : musicAlbum)[s.albumId] = 1;
      [s.artistId, s.albumArtistId].forEach(function (id) { if (id) (isPod ? podArtist : musicArtist)[id] = 1; });
    });
    podcastEpisodes = songs.filter(function (s) { return s._pod; }).length;
    songs = songs.filter(function (s) { return !s._pod; });
    albums = albums.filter(function (a) { return !(podAlbum[a.id] && !musicAlbum[a.id]); });
    artists = artists.filter(function (a) { return !(podArtist[a.id] && !musicArtist[a.id]); });

    var cur = ext === null ? TRACKS[state.currentTrackIndex] : null;
    var prevId = cur ? cur.id : null;
    var queueIds = queue ? queue.map(function (i) { return TRACKS[i] && TRACKS[i].id; }) : null;
    var albumInfo = {};
    albums.forEach(function (a) { albumInfo[a.id] = a; });

    TRACKS.length = 0;
    var albumQuality = {}, artistGenre = {}, albumPlays = {};
    songs.forEach(function (s) {
      var suf = (s.suffix || '').toUpperCase();
      var lossless = !!LOSSLESS[suf];
      var al = albumInfo[s.albumId];
      var q = lossless ? suf : (suf + ' ' + (s.bitRate || '')).trim();
      TRACKS.push({
        id: s.id,
        num: s.trackNumber || 0,
        disc: s.discNumber || 1,
        title: esc(s.title),
        artist: esc(s.artist || s.albumArtist || '—'),
        album: esc(s.album || '—'),
        year: s.year || (al && al.maxYear) || '—',
        quality: q,
        bitrate: (s.bitRate || 0) + ' kbps',
        duration: fmtDur(s.duration),
        sec: Math.max(1, Math.round(s.duration || 0)),
        plays: s.playCount || 0,
        fav: !!s.starred,
        cover: coverUrl(s.albumId || ('mf-' + s.id), 400),
        color1: hexToRgba(al && al.dominantColor, 0.30),
        albumId: s.albumId,
        artistId: s.artistId,
        genre: s.genre || '',
        rawTitle: s.title || '', rawArtist: s.artist || '', rawAlbum: s.album || '',
        added: s.createdAt || '', lastPlayed: s.playDate || '', rating: s.rating || 0,
        path: s.path || '', bpm: s.bpm || 0,
        genres: (s.genres || []).map(function (g) { return g.name; }).filter(Boolean).join(' / ') || s.genre || '',
        mbzAlbumId: s.mbzAlbumId || '', mbzReleaseGroupId: s.mbzReleaseGroupId || '', mbzAlbumArtistId: s.mbzAlbumArtistId || ''
      });
      if (s.albumId && !albumQuality[s.albumId]) albumQuality[s.albumId] = q;
      if (s.albumId) albumPlays[s.albumId] = (albumPlays[s.albumId] || 0) + (s.playCount || 0);
      if (s.artistId && s.genre && !artistGenre[s.artistId]) artistGenre[s.artistId] = s.genre;
    });

    ALBUMS.length = 0;
    albums.forEach(function (a) {
      if (a.missing) return;
      ALBUMS.push({
        id: a.id, title: esc(a.name), artist: esc(a.albumArtist || a.artist || '—'),
        year: a.maxYear || a.minYear || '—', tracks: a.songCount || 0,
        quality: albumQuality[a.id] || '', fav: !!a.starred, plays: albumPlays[a.id] || 0,
        cover: coverUrl(a.id, 400), color: a.dominantColor || '#3b8cff', artistId: a.albumArtistId,
        rgid: a.mbzReleaseGroupId || '', rawTitle: a.name || '', artistMbid: a.mbzAlbumArtistId || ''
      });
    });

    ARTISTS.length = 0;
    artists.forEach(function (ar) {
      if (ar.missing || !ar.songCount) return;
      ARTISTS.push({
        id: ar.id, name: esc(ar.name), country: '', genre: esc(artistGenre[ar.id] || ''),
        albums: ar.albumCount || 0, tracks: ar.songCount || 0, cover: coverUrl('ar-' + ar.id, 400),
        mbid: ar.mbzArtistId || '', rawName: ar.name || ''
      });
    });

    var keepPl = state.selectedPlaylistId;
    PLAYLISTS.length = 0;
    pls.forEach(function (p) {
      PLAYLISTS.push({
        id: p.id, name: esc(p.name), desc: esc(p.comment || ''), count: p.songCount || 0,
        sync: !!p.sync, source: p.ownerName ? ('Guitarr · ' + esc(p.ownerName)) : 'Guitarr',
        cover: coverUrl('pl-' + p.id, 300), trackIdx: null
      });
    });
    PLAYLISTS.unshift({
      id: FAV_ID, name: 'Músicas Curtidas', desc: 'As faixas que você curtiu com o coração ♥', count: 0,
      sync: false, virtual: true, source: 'Sua biblioteca', cover: FAV_COVER, trackIdx: []
    });
    if (keepPl && !PLAYLISTS.some(function (p) { return p.id === keepPl; })) state.selectedPlaylistId = null;

    // volta a apontar para a faixa que estava tocando
    if (prevId) {
      var ni = TRACKS.findIndex(function (t) { return t.id === prevId; });
      state.currentTrackIndex = ni >= 0 ? ni : 0;
    } else if (state.currentTrackIndex >= TRACKS.length) {
      state.currentTrackIndex = 0;
    }
    // a fila continua a mesma depois da recarga (índices mudam, ids não)
    queue = null;
    if (queueIds) {
      var byId = {};
      TRACKS.forEach(function (t, i) { byId[t.id] = i; });
      var q = queueIds.map(function (id) { return byId[id]; }).filter(function (i) { return i !== undefined; });
      if (q.length && prevId && q.indexOf(state.currentTrackIndex) >= 0) queue = q;
    }
    libraryLoaded = true;
    syncFavPlaylist(true);
  }

  function refreshChrome() {
    renderSidebarPlaylists();
    updatePlayerUI();
    renderCurrentView();
    setText('nav-songs-count', String(TRACKS.length));
    setText('nav-albums-count', String(ALBUMS.length));
    setText('nav-artists-count', String(ARTISTS.length));
    if (auth) {
      var nm = auth.name || auth.username;
      setText('sidebar-conn-label', 'online');
      setText('seer-user-name', nm);
      setText('seer-user-avatar', nm.charAt(0).toUpperCase());
    }
    var nm2 = $('nav-meta'); if (nm2) nm2.style.display = (auth && auth.isAdmin) ? '' : 'none';
    var nc2 = $('nav-cfg'); if (nc2) nc2.style.display = (auth && auth.isAdmin) ? '' : 'none';
    var vs = $('volume-slider'); if (vs) vs.value = state.isMuted ? 0 : state.volume;
    var pill = $('synth-sound-pill'); if (pill) pill.style.display = 'none';
    var qb = $('np-quality-badge');
    if (!TRACKS.length) {
      setText('player-title', 'Biblioteca vazia');
      setText('player-artist', 'Peça músicas na aba Pedidos');
      setText('player-time-total', '00:00');
      // biblioteca nova: o painel "Tocando agora" não mostra a faixa de exemplo do protótipo
      setText('np-track-title', 'Biblioteca vazia');
      setText('np-track-artist', '');
      if (qb) qb.style.display = 'none';
    } else if (qb) qb.style.display = '';
  }

  window.greeting = function () {
    var h = new Date().getHours();
    var g = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
    var n = auth && auth.name ? auth.name.charAt(0).toUpperCase() + auth.name.slice(1) : '';
    return n ? g + ', ' + esc(n) : g;
  };

  function scheduleReload(delay) {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(async function () {
      try { await loadLibrary(); refreshChrome(); } catch (e) { /* tenta de novo no próximo evento */ }
    }, delay || 4000);
  }

  // ----------------------------------------------------------------- audio ---
  function currentTrack() { return TRACKS[state.currentTrackIndex]; }

  function updateMediaSession(title, artist, album, cover) {
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: unesc(title), artist: unesc(artist), album: unesc(album || ''),
        artwork: cover ? [{ src: cover, sizes: '400x400', type: 'image/jpeg' }] : []
      });
    } catch (e) {}
  }

  function applyVolume() { audio.volume = state.isMuted ? 0 : Math.min(1, Math.max(0, state.volume / 100)); }

  function playOrToast() {
    var p = audio.play();
    if (p && p.catch) {
      p.catch(function (err) {
        if (err && err.name === 'AbortError') return;
        state.isPlaying = false;
        updatePlayerUI();
        toast(err && err.name === 'NotAllowedError' ? 'Toque em ▶ para iniciar o áudio' : 'Não foi possível tocar esta faixa');
      });
    }
  }

  function syncAudio() {
    applyVolume();
    if (ext) {
      if (state.isPlaying) playOrToast(); else audio.pause();
      return;
    }
    var t = currentTrack();
    if (!t) { audio.pause(); return; }
    var key = 'mf:' + t.id;
    if (loadedKey !== key) {
      loadedKey = key;
      scrobbled = false;
      switching = true;
      setTimeout(function () { switching = false; }, 300);
      audio.src = streamUrl(t.id);
      if (state.currentTimeSec > 1) { try { audio.currentTime = state.currentTimeSec; } catch (e) {} }
      updateMediaSession(t.title, t.artist, t.album, t.cover);
      if (state.isPlaying) subsonic('scrobble', { id: t.id, submission: 'false' }).catch(function () {});
    } else if (Math.abs(audio.currentTime - state.currentTimeSec) > 1.5) {
      try { audio.currentTime = state.currentTimeSec; } catch (e) {}
    }
    if (state.isPlaying) playOrToast(); else audio.pause();
  }
  window.startPlaybackLoop = syncAudio;
  window.ensureAudioContext = function () {};

  audio.addEventListener('timeupdate', function () {
    if (ext) { if (!ext.live) updateProgressUI(); return; }
    var t = currentTrack();
    if (!t || loadedKey !== 'mf:' + t.id) return;
    state.currentTimeSec = audio.currentTime;
    updateProgressUI();
    if (!scrobbled && audio.duration && audio.currentTime > Math.min(240, audio.duration * 0.5)) {
      scrobbled = true;
      subsonic('scrobble', { id: t.id, submission: 'true' }).catch(function () {});
    }
  });
  audio.addEventListener('ended', function () {
    if (ext) { ext = null; state.isPlaying = false; updatePlayerUI(); return; }
    if (state.isRepeat) { audio.currentTime = 0; playOrToast(); return; }
    window.nextTrack();
  });
  audio.addEventListener('pause', function () {
    if (audio.ended || switching || !state.isPlaying) return;
    state.isPlaying = false; updatePlayerUI();
  });
  audio.addEventListener('play', function () {
    if (state.isPlaying) return;
    state.isPlaying = true; updatePlayerUI();
  });
  var errShown = 0;
  audio.addEventListener('error', function () {
    if (!audio.src || Date.now() - errShown < 3000) return;
    errShown = Date.now();
    toast('Erro ao carregar o áudio');
  });

  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.setActionHandler('play', function () { if (!state.isPlaying) window.togglePlay(); });
      navigator.mediaSession.setActionHandler('pause', function () { if (state.isPlaying) window.togglePlay(); });
      navigator.mediaSession.setActionHandler('previoustrack', function () { window.prevTrack(); });
      navigator.mediaSession.setActionHandler('nexttrack', function () { window.nextTrack(); });
    } catch (e) {}
  }

  // --- fila e navegação entre faixas
  function startTrack(i) {
    ext = null;
    state.currentTrackIndex = i;
    state.currentTimeSec = 0;
    state.isPlaying = true;
    updatePlayerUI();
    renderCurrentView();
    syncAudio();
  }

  function indexesWhere(fn) {
    var out = [];
    for (var i = 0; i < TRACKS.length; i++) if (fn(TRACKS[i])) out.push(i);
    return out;
  }

  function contextQueue() {
    if (state.currentView === 'songs' && window.songsViewList) {
      return window.songsViewList().map(function (t) { return TRACKS.indexOf(t); }).filter(function (i) { return i >= 0; });
    }
    if (state.currentView === 'albumDetail') {
      var al = ALBUMS.find(function (a) { return a.id === state.selectedAlbumId; });
      if (al) return indexesWhere(function (t) { return t.albumId === al.id; })
        .sort(function (a, b) { return byDiscTrack(TRACKS[a], TRACKS[b]); });
    } else if (state.currentView === 'artistDetail') {
      var nm = (state.selectedArtistName || '').toLowerCase();
      return indexesWhere(function (t) { return t.artist.toLowerCase() === nm; });
    } else if (state.currentView === 'playlistDetail') {
      var pl = PLAYLISTS.find(function (p) { return p.id === state.selectedPlaylistId; });
      if (pl && pl.trackIdx) return pl.trackIdx.slice();
    }
    return null;
  }

  // --- ordenar a tela Músicas (guardado neste navegador)
  var SONG_SORTS = [
    ['added', 'Adicionadas recentemente', -1], ['title', 'Nome da música', 1], ['artist', 'Artista', 1],
    ['album', 'Álbum', 1], ['year', 'Ano de lançamento', -1], ['plays', 'Mais tocadas', -1],
    ['lastPlayed', 'Tocadas recentemente', -1], ['duration', 'Duração', 1], ['quality', 'Qualidade', -1]
  ];
  var songSort = { key: 'added', dir: -1 };
  try { var ss = JSON.parse(localStorage.getItem('seer_song_sort') || 'null'); if (ss && ss.key) songSort = ss; } catch (e) {}
  var collator = new Intl.Collator(window.seerLocale ? window.seerLocale() : 'pt-BR', { sensitivity: 'base', numeric: true });
  function qualityRank(t) { return /FLAC|ALAC|WAV|AIFF|APE|WV|DSF|DFF/.test(t.quality) ? 100000 : (parseInt(t.bitrate, 10) || 0); }
  function sortValue(t, key) {
    switch (key) {
      case 'title': return t.rawTitle || t.title;
      case 'artist': return t.rawArtist || t.artist;
      case 'album': return t.rawAlbum || t.album;
      case 'year': return typeof t.year === 'number' ? t.year : 0;
      case 'plays': return t.plays || 0;
      case 'lastPlayed': return t.lastPlayed || '';
      case 'duration': return t.sec || 0;
      case 'quality': return qualityRank(t);
      default: return t.added || '';
    }
  }
  window.seerSortSongs = function (list) {
    var key = songSort.key, dir = songSort.dir;
    return list.slice().sort(function (a, b) {
      var va = sortValue(a, key), vb = sortValue(b, key), c;
      c = typeof va === 'number' ? va - vb : collator.compare(String(va), String(vb));
      if (c) return c * dir;
      // desempate estável: artista, álbum, disco, faixa
      return collator.compare(a.rawArtist || a.artist, b.rawArtist || b.artist) ||
        collator.compare(a.rawAlbum || a.album, b.rawAlbum || b.album) || byDiscTrack(a, b);
    });
  };
  window.seerSortControl = function () {
    var opts = SONG_SORTS.map(function (o) {
      return '<option value="' + o[0] + '"' + (o[0] === songSort.key ? ' selected' : '') + '>' + o[1] + '</option>';
    }).join('');
    return '<div class="flex items-center gap-2">' +
      '<label class="text-xs font-bold text-[#a7a7b0]" for="song-sort-select">Ordenar</label>' +
      '<select id="song-sort-select" onchange="setSongSort(this.value)" class="px-3 py-1.5 rounded-full text-xs font-bold bg-white/[0.08] hover:bg-white/[0.14] text-white border border-white/10 focus:outline-none focus:border-[#3b8cff] cursor-pointer">' + opts + '</select>' +
      '<button type="button" onclick="toggleSongSortDir()" title="' + (songSort.dir > 0 ? 'Crescente' : 'Decrescente') + ' (clique para inverter)" class="w-8 h-8 rounded-full bg-white/[0.08] hover:bg-white/[0.14] text-white flex items-center justify-center transition">' +
      '<svg class="w-4 h-4 transition-transform' + (songSort.dir > 0 ? '' : ' rotate-180') + '" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 19V5m0 0l-6 6m6-6l6 6"/></svg></button></div>';
  };
  function saveSongSort() { try { localStorage.setItem('seer_song_sort', JSON.stringify(songSort)); } catch (e) {} renderCurrentView(); }
  window.setSongSort = function (key) {
    var def = SONG_SORTS.find(function (o) { return o[0] === key; });
    songSort = { key: key, dir: def ? def[2] : 1 };
    saveSongSort();
  };
  window.playSongsView = function () {
    var first = window.songsViewList ? window.songsViewList()[0] : null;
    window.playTrackByIndex(first ? TRACKS.indexOf(first) : 0);
  };
  window.toggleSongSortDir = function () { songSort.dir = -songSort.dir; saveSongSort(); };

  window.playTrackByIndex = function (idx) {
    if (!TRACKS.length) return;
    if (idx < 0 || idx >= TRACKS.length) idx = 0;
    var ctx = contextQueue();
    queue = ctx && ctx.indexOf(idx) >= 0 ? ctx : null;
    if (!ext && state.currentTrackIndex === idx && loadedKey === 'mf:' + TRACKS[idx].id) {
      state.isPlaying = !state.isPlaying;
      updatePlayerUI(); renderCurrentView(); syncAudio();
    } else {
      startTrack(idx);
    }
  };

  window.togglePlay = function () {
    if (!TRACKS.length && !ext) return;
    state.isPlaying = !state.isPlaying;
    updatePlayerUI(); renderCurrentView(); syncAudio();
  };

  window.nextTrack = function () {
    if (!TRACKS.length) return;
    var cur = state.currentTrackIndex, next;
    if (queue && queue.length) {
      if (state.isShuffle) next = queue[Math.floor(Math.random() * queue.length)];
      else next = queue[(queue.indexOf(cur) + 1) % queue.length];
    } else {
      next = state.isShuffle ? Math.floor(Math.random() * TRACKS.length) : (cur + 1) % TRACKS.length;
    }
    startTrack(next);
  };

  window.prevTrack = function () {
    if (!TRACKS.length) return;
    if (state.currentTimeSec > 5 && !ext) {
      state.currentTimeSec = 0;
      try { audio.currentTime = 0; } catch (e) {}
      updateProgressUI();
      return;
    }
    var cur = state.currentTrackIndex, prev;
    if (queue && queue.length) {
      var p = queue.indexOf(cur);
      prev = queue[(p <= 0 ? queue.length : p) - 1];
    } else {
      prev = (cur - 1 + TRACKS.length) % TRACKS.length;
    }
    startTrack(prev);
  };

  window.shuffleAllTracks = function () {
    if (!TRACKS.length) return;
    state.isShuffle = true;
    var btn = $('btn-shuffle');
    if (btn) btn.className = 'text-[#3b8cff] transition relative';
    queue = null;
    startTrack(Math.floor(Math.random() * TRACKS.length));
    toast('Tocando a biblioteca em ordem aleatória');
  };

  window.seekAudio = function (e) {
    var bar = $('progress-bar-container');
    if (!bar) return;
    var rect = bar.getBoundingClientRect();
    var ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    if (ext) {
      if (ext.live || !audio.duration) return;
      audio.currentTime = ratio * audio.duration;
      return;
    }
    var t = currentTrack();
    if (!t) return;
    state.currentTimeSec = Math.floor(ratio * t.sec);
    try { audio.currentTime = state.currentTimeSec; } catch (err) {}
    updateProgressUI();
  };

  var origChangeVolume = window.changeVolume;
  window.changeVolume = function (v) { origChangeVolume(v); applyVolume(); };
  window.toggleMute = function () {
    state.isMuted = !state.isMuted;
    var s = $('volume-slider'); if (s) s.value = state.isMuted ? 0 : state.volume;
    applyVolume();
    toast(state.isMuted ? 'Áudio silenciado' : 'Áudio ativado');
  };
  window.toggleSynthSound = function () {};

  // --- player: modo externo (podcast / rádio) e fila vazia
  var origUpdatePlayerUI = window.updatePlayerUI;
  window.updatePlayerUI = function () {
    if (!ext && !TRACKS[state.currentTrackIndex]) return;
    if (!ext) { origUpdatePlayerUI(); return; }
    var cov = ext.cover || (TRACKS[0] && TRACKS[0].cover) || '';
    if ($('player-cover')) $('player-cover').src = cov;
    setText('player-title', unesc(ext.title));
    setText('player-artist', unesc(ext.subtitle));
    ['player-sep', 'player-album', 'player-year'].forEach(function (id) {
      var el = $(id); if (el) { if (id === 'player-year') el.textContent = ''; else el.classList.add('hidden'); }
    });
    setText('player-badge', ext.live ? 'AO VIVO' : 'PODCAST');
    if ($('np-cover-img')) $('np-cover-img').src = cov;
    setText('np-track-title', unesc(ext.title));
    setText('np-track-artist', unesc(ext.subtitle));
    setText('np-quality-badge', ext.live ? 'Rádio ao vivo' : 'Podcast');
    setText('np-meta-album', unesc(ext.subtitle));
    setText('np-meta-year', '');
    var playIcon = $('icon-play-main'), pauseIcon = $('icon-pause-main'), vinyl = $('np-vinyl-disc');
    if (playIcon && pauseIcon) {
      playIcon.classList.toggle('hidden', !!state.isPlaying);
      pauseIcon.classList.toggle('hidden', !state.isPlaying);
    }
    if (vinyl) vinyl.classList.toggle('vinyl-paused', !state.isPlaying);
    updateProgressUI();
    var q = $('np-queue-list'); if (q) q.innerHTML = '';
  };

  var origUpdateProgressUI = window.updateProgressUI;
  window.updateProgressUI = function () {
    if (ext) {
      var dur = ext.live ? 0 : (audio.duration || 0);
      var cur = audio.currentTime || 0;
      var pct = dur ? Math.min(100, (cur / dur) * 100) : 0;
      setText('player-time-current', fmtDur(cur));
      setText('player-time-total', ext.live ? 'AO VIVO' : fmtDur(dur));
      var f = $('progress-bar-fill'), th = $('progress-bar-thumb');
      if (f) f.style.width = pct.toFixed(1) + '%';
      if (th) th.style.left = pct.toFixed(1) + '%';
      return;
    }
    if (!TRACKS[state.currentTrackIndex]) return;
    origUpdateProgressUI();
  };

  window.renderQueueList = function () {
    var c = $('np-queue-list');
    if (!c) return;
    if (!TRACKS.length) { c.innerHTML = ''; return; }
    var n = TRACKS.length, cur = state.currentTrackIndex, list = [];
    for (var k = 1; k <= 3; k++) {
      var idx;
      if (queue && queue.length) {
        var p = queue.indexOf(cur);
        idx = queue[(p + k) % queue.length];
      } else idx = (cur + k) % n;
      if (list.indexOf(idx) < 0 && idx !== cur) list.push(idx);
    }
    c.innerHTML = list.map(function (idx) {
      var t = TRACKS[idx];
      return '<button type="button" onclick="playTrackByIndex(' + idx + ')" class="w-full flex items-center gap-2.5 p-2 rounded-lg hover:bg-white/[0.06] transition text-left group">' +
        '<img src="' + t.cover + '" alt="" class="w-9 h-9 rounded object-cover flex-shrink-0" />' +
        '<div class="min-w-0 flex-1"><div class="text-xs font-bold text-white group-hover:text-[#3b8cff] truncate">' + t.title + '</div>' +
        '<div class="text-[11px] text-[#a7a7b0] truncate">' + t.artist + '</div></div>' +
        '<span class="text-[10px] font-mono text-[#a7a7b0]">' + t.duration + '</span></button>';
    }).join('');
  };

  // painel "Tocando Agora": o mock alternava 'hidden' e 'lg:flex' ao mesmo tempo e o
  // painel nunca fechava; aqui o estado fica no style.display.
  window.toggleRightDrawer = function () {
    var d = $('right-drawer');
    if (!d) return;
    var open = d.style.display !== 'none';
    d.style.display = open ? 'none' : '';
    state.rightDrawerOpen = !open;
    try { localStorage.setItem('nd_seer_drawer', open ? '0' : '1'); } catch (e) {}
  };
  try { if (localStorage.getItem('nd_seer_drawer') === '0') { var _d = $('right-drawer'); if (_d) _d.style.display = 'none'; } } catch (e) {}

  // ------------------------------------------------- favoritos / navegação ---
  function toggleFav(t) {
    t.fav = !t.fav;
    syncFavPlaylist();
    updatePlayerUI(); renderCurrentView();
    toast(t.fav ? '"' + t.title + '" adicionada aos Favoritos ♥' : '"' + t.title + '" removida dos Favoritos');
    subsonic(t.fav ? 'star' : 'unstar', { id: t.id }).catch(function () {
      t.fav = !t.fav;
      syncFavPlaylist();
      updatePlayerUI(); renderCurrentView();
      toast('Não foi possível atualizar o favorito');
    });
  }
  window.toggleCurrentFavorite = function () {
    if (ext) return;
    var t = currentTrack(); if (t) toggleFav(t);
  };
  window.toggleTrackFav = function (id) {
    var t = TRACKS.find(function (x) { return x.id === id; });
    if (t) toggleFav(t);
  };

  window.openAlbumByTitle = function (albumTitle) {
    var key = esc(albumTitle).toLowerCase();
    var found = ALBUMS.find(function (a) { return a.title.toLowerCase() === key; });
    if (!found) { toast('Álbum não encontrado'); return; }
    state.selectedAlbumId = found.id;
    switchView('albumDetail');
  };
  window.playAlbumQuick = function (albumTitle) {
    var key = esc(albumTitle).toLowerCase();
    var album = (state.currentView === 'albumDetail' && ALBUMS.find(function (a) {
      return a.id === state.selectedAlbumId && a.title.toLowerCase() === key;
    })) || ALBUMS.find(function (a) { return a.title.toLowerCase() === key; });
    var idxs = album
      ? indexesWhere(function (t) { return t.albumId === album.id; })
      : indexesWhere(function (t) { return t.album.toLowerCase() === key; });
    idxs.sort(function (a, b) { return byDiscTrack(TRACKS[a], TRACKS[b]); });
    if (!idxs.length) { toast('Nenhuma faixa encontrada'); return; }
    queue = idxs;
    startTrack(idxs[0]);
    toast('Tocando álbum "' + (album ? album.title : albumTitle) + '"');
  };
  window.openArtistByName = function (name) {
    var key = esc(name).toLowerCase();
    var found = ARTISTS.find(function (a) { return a.name.toLowerCase() === key; });
    if (!found) {
      var own = TRACKS.filter(function (t) { return t.artist.toLowerCase() === key; });
      if (!own.length) { toast('Artista não encontrado na biblioteca'); return; }
      var albs = {};
      own.forEach(function (t) { albs[t.albumId] = 1; });
      found = { id: 'x:' + key, name: own[0].artist, country: '', genre: esc(own[0].genre),
        albums: Object.keys(albs).length, tracks: own.length, cover: own[0].cover };
      ARTISTS.push(found);
    }
    state.selectedArtistName = found.name;
    switchView('artistDetail');
  };
  window.openCurrentAlbum = function () {
    var t = currentTrack();
    if (ext || !t) return;
    if (!t.albumId || !ALBUMS.some(function (a) { return a.id === t.albumId; })) { toast('Álbum não encontrado'); return; }
    state.selectedAlbumId = t.albumId;
    switchView('albumDetail');
  };
  window.openCurrentArtist = function () {
    var t = currentTrack();
    if (!ext && t) window.openArtistByName(unesc(t.artist));
  };
  window.playArtistQuick = function (name) {
    var key = esc(name).toLowerCase();
    var idxs = indexesWhere(function (t) { return t.artist.toLowerCase() === key; });
    if (!idxs.length) { toast('Nenhuma faixa encontrada'); return; }
    queue = idxs;
    startTrack(idxs[0]);
    toast('Tocando faixas de ' + name);
  };

  // --- playlists reais
  async function ensurePlaylistTracks(pl) {
    if (pl.virtual) { syncFavPlaylist(true); return; }
    if (pl.trackIdx) return;
    var rows = await apiJson('/api/playlist/' + encodeURIComponent(pl.id) + '/tracks?_start=0&_end=2000');
    var byId = {};
    TRACKS.forEach(function (t, i) { byId[t.id] = i; });
    pl.trackIdx = (rows || []).map(function (r) {
      return byId[r.mediaFileId || r.id];
    }).filter(function (i) { return i !== undefined; });
  }
  window.openPlaylistView = async function (id) {
    state.selectedPlaylistId = id;
    var pl = PLAYLISTS.find(function (p) { return p.id === id; });
    if (pl) { try { await ensurePlaylistTracks(pl); } catch (e) { toast('Erro ao abrir a playlist: ' + errMsg(e)); pl.trackIdx = []; } }
    switchView('playlistDetail');
  };
  window.openFavorites = function () { window.openPlaylistView(FAV_ID); };
  window.playPlaylist = function (id) {
    var pl = PLAYLISTS.find(function (p) { return p.id === id; });
    if (!pl || !pl.trackIdx || !pl.trackIdx.length) { toast(pl && pl.virtual ? 'Curta músicas com o ♥ para vê-las aqui' : 'Playlist vazia'); return; }
    queue = pl.trackIdx.slice();
    startTrack(queue[0]);
  };
  window.renderPlaylistDetailView = function () {
    var pl = PLAYLISTS.find(function (p) { return p.id === state.selectedPlaylistId; }) || PLAYLISTS[0];
    if (!pl) return '<div class="py-12 text-center text-sm text-[#a7a7b0]">Nenhuma playlist.</div>';
    var tracks = (pl.trackIdx || []).map(function (i) { return TRACKS[i]; });
    return '<div class="view-animate space-y-6 pb-8">' +
      '<div class="flex flex-col sm:flex-row items-start sm:items-end gap-6 p-6 rounded-2xl bg-gradient-to-b from-purple-500/20 to-transparent border border-white/[0.06]">' +
      '<img src="' + pl.cover + '" alt="" class="w-40 h-40 rounded-2xl object-cover shadow-2xl bg-white/5" />' +
      '<div class="flex-1"><div class="text-xs font-extrabold uppercase tracking-wider text-[#3b8cff] mb-1">Playlist · ' + pl.source + '</div>' +
      '<h1 class="font-display font-black text-3xl sm:text-5xl text-white tracking-tight mb-2">' + pl.name + '</h1>' +
      '<p class="text-xs text-zinc-300 mb-4">' + (pl.desc ? pl.desc + ' · ' + pl.count + ' músicas' : (pl.count + ' músicas')) + '</p>' +
      '<div class="flex gap-3"><button type="button" onclick="playPlaylist(\'' + pl.id + '\')" class="h-11 px-6 rounded-full bg-[#3b8cff] text-black font-extrabold text-xs flex items-center gap-2">' +
      '<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>Reproduzir Playlist</button>' +
      (pl.virtual ? '' : '<button type="button" onclick="copyShareLink()" class="h-11 px-5 rounded-full bg-white/10 hover:bg-white/15 text-white font-bold text-xs">Compartilhar Link</button>') + '</div>' +
      '</div></div>' + renderTrackTableRows(tracks) + '</div>';
  };
  window.copyShareLink = function () {
    toast('Crie links de compartilhamento na seção Rádios & Links');
  };

  // --- metadados / exclusão (Guitarr library editor, só admin)
  window.openMetadataModal = function (trackId) {
    var t = TRACKS.find(function (x) { return x.id === trackId; }) || currentTrack();
    if (!t) return;
    state.editingTrackId = t.id;
    $('meta-track-id').value = t.id;
    $('meta-title').value = t.rawTitle;
    $('meta-artist').value = t.rawArtist;
    $('meta-album').value = t.rawAlbum;
    $('meta-year').value = typeof t.year === 'number' ? t.year : '';
    $('meta-tracknum').value = t.num || '';
    $('meta-genre').value = t.genre || '';
    $('meta-mbz-album').value = t.mbzAlbumId || '';
    $('meta-mbz-group').value = t.mbzReleaseGroupId || '';
    $('meta-mbz-artist').value = t.mbzAlbumArtistId || '';
    $('meta-mbz-all').checked = true;
    $('meta-mb-link').href = 'https://musicbrainz.org/search?type=release_group&query=' + encodeURIComponent(t.rawAlbum + ' ' + t.rawArtist);
    $('meta-cover-prev').src = t.albumId ? coverUrl(t.albumId, 120) : '';
    showModal('modal-metadata');
  };
  // Abre o editor pela primeira faixa carregada do álbum (usado em Organizar Metadados).
  window.openMetadataModalForAlbum = function (albumId) {
    var t = TRACKS.find(function (x) { return x.albumId === albumId; });
    if (!t) { toast('Nenhuma faixa deste álbum está carregada. Atualize a biblioteca.'); return; }
    window.openMetadataModal(t.id);
  };
  // O código pode vir como UUID puro ou como link da página do MusicBrainz.
  function parseMbid(v) {
    var m = String(v || '').toLowerCase().match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    return m ? m[0] : '';
  }
  // Envia uma imagem (JPG/PNG) como capa do álbum inteiro.
  async function uploadCover(albumId, file) {
    if (!file) throw new Error('Nenhum arquivo escolhido.');
    if (!/^image\/(jpeg|png)$/.test(file.type)) throw new Error('Use uma imagem JPG ou PNG.');
    if (file.size > 15 * 1024 * 1024) throw new Error('A imagem passa de 15 MB.');
    var r = await apiJson('/api/seer/library/album/' + encodeURIComponent(albumId) + '/cover', { method: 'PUT', raw: file });
    coverBust[albumId] = Date.now();
    return r;
  }
  window.uploadCoverFromModal = async function (input) {
    var f = input.files && input.files[0]; input.value = '';
    var t = TRACKS.find(function (x) { return x.id === $('meta-track-id').value; });
    if (!f || !t || !t.albumId) return;
    if (!auth.isAdmin) { toast('Apenas administradores podem trocar capas'); return; }
    toast('Enviando capa…');
    try {
      await uploadCover(t.albumId, f);
      $('meta-cover-prev').src = coverUrl(t.albumId, 120);
      toast('Capa salva no álbum "' + unesc(t.album) + '"');
      scheduleReload(3000);
    } catch (err) { toast('Erro ao enviar capa: ' + errMsg(err)); }
  };
  window.openMetadataModalForCurrent = function () {
    var t = currentTrack(); if (t && !ext) window.openMetadataModal(t.id);
  };
  window.saveMetadataForm = async function (e) {
    e.preventDefault();
    var t = TRACKS.find(function (x) { return x.id === $('meta-track-id').value; });
    if (!t) return;
    if (!auth.isAdmin) { toast('Apenas administradores podem editar metadados'); return; }
    var ch = {
      title: $('meta-title').value, artist: $('meta-artist').value, album: $('meta-album').value,
      year: String($('meta-year').value || ''), trackNumber: String($('meta-tracknum').value || ''),
      genre: $('meta-genre').value
    };
    var codes = {}, codeChanged = false;
    var fields = [['mbzAlbumId', 'meta-mbz-album', 'do lançamento'], ['mbzReleaseGroupId', 'meta-mbz-group', 'do grupo'], ['mbzAlbumArtistId', 'meta-mbz-artist', 'do artista']];
    for (var fi = 0; fi < fields.length; fi++) {
      var raw = String($(fields[fi][1]).value || '').trim(), val = parseMbid(raw);
      if (raw && !val) { toast('Código ' + fields[fi][2] + ' inválido: cole o UUID ou o link do MusicBrainz'); return; }
      if (val !== (t[fields[fi][0]] || '')) { codes[fields[fi][0]] = val; codeChanged = true; }
    }
    Object.keys(codes).forEach(function (k) { ch[k] = codes[k]; });
    try {
      var saved = await api('/api/seer/library/song/' + encodeURIComponent(t.id), { method: 'PUT', json: ch });
      if (codeChanged && $('meta-mbz-all').checked) {
        var albumId = t.albumId;
        try { var sj = await saved.json(); if (sj && sj.albumId) albumId = sj.albumId; } catch (e2) {}
        if (albumId) await editAlbum(albumId, codes);
      }
      Object.keys(codes).forEach(function (k) { t[k] = codes[k]; });
      t.rawTitle = ch.title; t.title = esc(ch.title);
      t.rawArtist = ch.artist; t.artist = esc(ch.artist);
      t.rawAlbum = ch.album; t.album = esc(ch.album);
      t.year = parseInt(ch.year, 10) || t.year; t.num = parseInt(ch.trackNumber, 10) || t.num;
      t.genre = ch.genre;
      window.closeModal('modal-metadata');
      updatePlayerUI(); renderCurrentView();
      toast('Metadados gravados no arquivo. A biblioteca será reescaneada.');
      scheduleReload(8000);
    } catch (err) { toast('Erro ao salvar: ' + errMsg(err)); }
  };
  window.deleteCurrentEditingTrack = async function () {
    var id = state.editingTrackId;
    var i = TRACKS.findIndex(function (x) { return x.id === id; });
    if (i < 0) return;
    if (!auth.isAdmin) { toast('Apenas administradores podem excluir arquivos'); return; }
    if (!window.confirm('Excluir "' + unesc(TRACKS[i].title) + '" do disco? Esta ação não pode ser desfeita.')) return;
    try {
      await api('/api/seer/library/song/' + encodeURIComponent(id), { method: 'DELETE' });
      var removed = TRACKS.splice(i, 1)[0];
      queue = null;
      if (i < state.currentTrackIndex) state.currentTrackIndex--;
      else if (i === state.currentTrackIndex) { audio.pause(); state.isPlaying = false; loadedKey = null; state.currentTrackIndex = 0; }
      window.closeModal('modal-metadata');
      refreshChrome();
      toast('"' + removed.title + '" excluída do disco e da biblioteca');
      scheduleReload(8000);
    } catch (err) { toast('Erro ao excluir: ' + errMsg(err)); }
  };

  // --- outras versões: troca o arquivo da faixa por outra gravação (patch 0034, só admin)
  var ver = { songId: '', list: null, error: '', job: null, poll: null };
  var VER_STEP = { downloading: 'Baixando a versão escolhida…', replacing: 'Substituindo o arquivo…',
    done: 'Pronto: o arquivo foi trocado.', failed: 'Falhou: ' };
  function versionsModal() {
    var m = $('modal-versions');
    if (m) return m;
    m = document.createElement('div');
    m.id = 'modal-versions';
    m.className = 'fixed inset-0 z-[60] bg-black/75 backdrop-blur-sm hidden items-center justify-center p-4';
    m.innerHTML = '<div class="bg-[#1b1b22] border border-white/10 rounded-2xl max-w-xl w-full max-h-[92vh] flex flex-col shadow-2xl">' +
      '<div class="flex items-start justify-between gap-3 p-5 pb-3"><div class="min-w-0"><h3 class="font-display font-extrabold text-lg text-white">Outras versões</h3>' +
      '<p id="ver-sub" class="text-xs text-[#a7a7b0] truncate"></p></div>' +
      '<button type="button" onclick="closeModal(\'modal-versions\')" class="text-[#a7a7b0] hover:text-white p-1">✕</button></div>' +
      '<div id="ver-status" class="hidden mx-5 mb-3 px-3 py-2 rounded-xl text-xs font-bold"></div>' +
      '<div id="ver-body" class="px-5 pb-5 overflow-y-auto space-y-1.5"></div></div>';
    document.body.appendChild(m);
    return m;
  }
  function verRow(v, i, cur) {
    var web = !!v.url, sec = Math.round((v.durationMs || 0) / 1000);
    var diff = sec && cur ? sec - cur : 0;
    var meta = [];
    if (v.album) meta.push(esc(v.album));
    if (v.year) meta.push(v.year);
    if (web && v.channel) meta.push(esc(v.channel.split(' ').slice(0, 4).join(' ')));
    var badge = web ? v.source : 'MusicBrainz';
    var link = web && /^https?:\/\//.test(v.url) ? ' <a href="' + esc(v.url) + '" target="_blank" rel="noopener" class="text-[#3b8cff] hover:underline">abrir ↗</a>' : '';
    return '<div class="flex items-center gap-3 p-2.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.06]">' +
      '<div class="flex-1 min-w-0"><div class="text-sm font-bold text-white truncate">' + esc(v.title) +
      (v.disambiguation ? ' <span class="text-[#3b8cff] font-semibold">(' + esc(v.disambiguation) + ')</span>' : '') + '</div>' +
      '<div class="text-[11px] text-[#a7a7b0] truncate"><span class="font-bold text-zinc-300">' + esc(badge) + '</span>' +
      (meta.length ? ' · ' + meta.join(' · ') : '') + link + '</div></div>' +
      '<div class="text-right flex-shrink-0"><div class="text-xs text-white tabular-nums">' + (sec ? fmtDur(sec) : '—') + '</div>' +
      (diff ? '<div class="text-[10px] text-[#a7a7b0] tabular-nums">' + (diff > 0 ? '+' : '') + diff + ' s</div>' : '') + '</div>' +
      '<button type="button" onclick="useVersion(' + i + ')" class="px-3 py-1.5 rounded-full text-xs font-bold bg-[#3b8cff] hover:bg-[#5aa0ff] text-black flex-shrink-0 disabled:opacity-40"' +
      (ver.job && (ver.job.status === 'downloading' || ver.job.status === 'replacing') ? ' disabled' : '') + '>Usar</button></div>';
  }
  function renderVersions() {
    var t = TRACKS.find(function (x) { return x.id === ver.songId; });
    setText('ver-sub', t ? unesc(t.title) + ' — ' + unesc(t.artist) + ' · atual ' + t.duration : '');
    var st = $('ver-status');
    if (st) {
      var j = ver.job;
      st.className = j ? 'mx-5 mb-3 px-3 py-2 rounded-xl text-xs font-bold ' +
        (j.status === 'failed' ? 'bg-red-500/15 text-red-300' : j.status === 'done' ? 'bg-[#3b8cff]/15 text-[#5aa0ff]' : 'bg-white/10 text-white') : 'hidden';
      st.textContent = j ? VER_STEP[j.status] + (j.status === 'failed' ? (j.error || 'erro desconhecido') : '') : '';
    }
    var body = $('ver-body');
    if (!body) return;
    if (ver.error) { body.innerHTML = '<p class="py-8 text-center text-sm text-red-300">' + esc(ver.error) + '</p>'; return; }
    if (!ver.list) { body.innerHTML = '<p class="py-8 text-center text-sm text-[#a7a7b0]">Procurando no MusicBrainz e nas fontes de download… (pode levar meio minuto)</p>'; return; }
    if (!ver.list.length) { body.innerHTML = '<p class="py-8 text-center text-sm text-[#a7a7b0]">Nenhuma outra versão encontrada.</p>'; return; }
    var cur = t ? t.sec : 0;
    body.innerHTML = '<p class="text-[11px] text-[#a7a7b0] pb-1">O arquivo atual é apagado e a versão escolhida entra no lugar com as mesmas tags, então favoritos, plays e playlists continuam.</p>' +
      ver.list.map(function (v, i) { return verRow(v, i, cur); }).join('');
  }
  function verPoll() {
    clearTimeout(ver.poll);
    var id = ver.songId;
    ver.poll = setTimeout(async function () {
      try { ver.job = await apiJson('/api/seer/library/song/' + encodeURIComponent(id) + '/versions/job'); } catch (e) { return; }
      if (id !== ver.songId) return;
      renderVersions();
      if (ver.job.status === 'done') { toast('Versão trocada. A biblioteca está sendo atualizada.'); scheduleReload(4000); }
      else if (ver.job.status === 'failed') toast('Não deu para trocar a versão: ' + (ver.job.error || ''));
      else verPoll();
    }, 3000);
  }
  window.openVersionsModal = async function () {
    if (!auth.isAdmin) { toast('Apenas administradores podem trocar arquivos'); return; }
    var id = $('meta-track-id').value;
    if (!id) return;
    clearTimeout(ver.poll);
    ver = { songId: id, list: null, error: '', job: null, poll: null };
    versionsModal();
    renderVersions();
    showModal('modal-versions');
    try {
      ver.job = await apiJson('/api/seer/library/song/' + encodeURIComponent(id) + '/versions/job');
      if (ver.job && (ver.job.status === 'downloading' || ver.job.status === 'replacing')) verPoll();
    } catch (e) { ver.job = null; }
    try {
      var list = await apiJson('/api/seer/library/song/' + encodeURIComponent(id) + '/versions');
      if (id === ver.songId) ver.list = Array.isArray(list) ? list : [];
    } catch (err) { if (id === ver.songId) ver.error = 'Erro ao buscar versões: ' + errMsg(err); }
    if (id === ver.songId) renderVersions();
  };
  window.useVersion = async function (i) {
    var v = ver.list && ver.list[i];
    var t = TRACKS.find(function (x) { return x.id === ver.songId; });
    if (!v || !t) return;
    var label = v.title + (v.disambiguation ? ' (' + v.disambiguation + ')' : '') + (v.url ? ' — ' + v.source : (v.album ? ' — ' + v.album : ''));
    if (!window.confirm('Trocar o arquivo de "' + unesc(t.title) + '" por "' + label + '"?\n\nO arquivo atual será apagado do disco.')) return;
    try {
      ver.job = await apiJson('/api/seer/library/song/' + encodeURIComponent(ver.songId) + '/versions', { method: 'POST', json: v });
      renderVersions();
      verPoll();
    } catch (err) { toast('Erro: ' + errMsg(err)); }
  };

  // ----------------------------------------------------------------- Guitarr ---
  var seer = { q: '', results: [], loading: false, error: '', detail: null, requests: [], shown: [],
    storage: null, timer: null, polling: null, lastStatus: {} };

  var STATUS_LABEL = { pending: 'Aguardando aprovação', queued: 'Na fila', searching: 'Buscando',
    downloading: 'Baixando', importing: 'Importando', available: 'Disponível', failed: 'Falhou' };
  var STATUS_PCT = { pending: 6, queued: 12, searching: 32, downloading: 62, importing: 90, available: 100, failed: 100 };
  function isActive(s) { return s === 'pending' || s === 'queued' || s === 'searching' || s === 'downloading' || s === 'importing'; }

  function caaCover(id, size) {
    return id ? 'https://coverartarchive.org/release-group/' + id + '/front-' + size : '';
  }
  function reqFor(item) {
    for (var i = 0; i < seer.requests.length; i++) {
      var r = seer.requests[i];
      if (r.mbid === item.mbid && r.kind === item.kind && r.status !== 'failed') return r;
    }
    return null;
  }

  // ------------------------------------------- discografia do artista ---
  // A página do artista junta os álbuns da biblioteca com a discografia oficial do MusicBrainz
  // (Album/EP, sem coletâneas, bootlegs nem mixtapes): o que falta pode ser pedido com 1 clique.
  var disco = {};   // nome do artista (minúsculo) -> { state, items, error }
  var discoFilter = 'all';
  var DISCO_SKIP = /compilation|dj-mix|mixtape|demo|interview|remix|spokenword|audiobook/i;
  function foldTitle(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[([][^)\]]*(deluxe|remaster|edition|edição|edicao|expanded|anniversary|bonus|version|versão|reissue|special|mono|stereo)[^)\]]*[)\]]/g, ' ')
      .replace(/\s+-\s+.*(deluxe|remaster|edition|anniversary|version).*$/g, ' ')
      .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function artistMbid(ar) {
    if (ar.mbid) return ar.mbid;
    var al = ALBUMS.find(function (a) { return a.artistId === ar.id && a.artistMbid; });
    return al ? al.artistMbid.split(/[;,]/)[0].trim() : '';
  }
  async function loadDiscography(ar) {
    var key = ar.name.toLowerCase();
    if (disco[key] && disco[key].state !== 'error') return;
    disco[key] = { state: 'loading', items: [] };
    try {
      var mbid = artistMbid(ar);
      if (!mbid) {
        var res = await apiJson('/api/seer/catalog?q=' + encodeURIComponent(ar.rawName || ar.name) + '&limit=10');
        var want = foldTitle(ar.rawName || ar.name);
        var hit = (res || []).find(function (c) { return c.kind === 'artist' && foldTitle(c.title || c.artist) === want; });
        mbid = hit ? hit.mbid : '';
      }
      if (!mbid) throw new Error('Artista não encontrado no MusicBrainz');
      var d = await apiJson('/api/seer/catalog/artist/' + encodeURIComponent(mbid));
      disco[key] = { state: 'ok', mbid: mbid, items: ((d && d.albums) || []).filter(function (c) {
        return c.kind === 'album' && /^(album|ep)/i.test(c.type || 'album') && !DISCO_SKIP.test(c.type || '');
      }) };
    } catch (e) {
      disco[key] = { state: 'error', items: [], error: errMsg(e) };
    }
    if (state.currentView === 'artistDetail' && (state.selectedArtistName || '').toLowerCase() === key) renderCurrentView();
  }
  // Lista final: álbuns locais + os do catálogo que faltam, cada um com status.
  function discoEntries(ar, localAlbums) {
    var d = disco[ar.name.toLowerCase()];
    var used = {}, out = [];
    var byRg = {}, byTitle = {};
    localAlbums.forEach(function (a) {
      if (a.rgid) byRg[a.rgid] = a;
      byTitle[foldTitle(a.rawTitle || a.title)] = a;
    });
    ((d && d.items) || []).forEach(function (c) {
      var local = byRg[c.mbid] || byTitle[foldTitle(c.title)] ||
        (c.inLibrary && c.libraryId && localAlbums.find(function (a) { return a.id === c.libraryId; }));
      if (local && used[local.id]) return; // outra edição do mesmo álbum local
      if (local) { used[local.id] = 1; out.push({ status: 'available', local: local, cat: c, year: c.year || local.year }); return; }
      var r = reqFor(c);
      var st = r && r.status !== 'available' ? 'pending' : (c.inLibrary ? 'available' : 'missing');
      out.push({ status: st, cat: c, req: r, year: c.year || 0 });
    });
    localAlbums.forEach(function (a) { if (!used[a.id]) out.push({ status: 'available', local: a, year: a.year }); });
    out.sort(function (a, b) { return (Number(b.year) || 0) - (Number(a.year) || 0); });
    return out;
  }
  window.seerDiscoFilter = function (f) {
    discoFilter = f;
    renderCurrentView();
    setTimeout(function () { var el = $('artist-discography'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 50);
  };
  window.seerRequestAlbum = async function (key, mbid) {
    var d = disco[key]; if (!d) return;
    var c = d.items.find(function (x) { return x.mbid === mbid; }); if (!c) return;
    // otimista: vira "Pedido" na hora
    var fake = { id: 'tmp-' + mbid, kind: 'album', mbid: mbid, status: 'pending', title: c.title, artist: c.artist };
    seer.requests.unshift(fake);
    renderCurrentView();
    try {
      var req = await apiJson('/api/seer/requests', { method: 'POST', json: c });
      seer.requests = seer.requests.filter(function (r) { return r !== fake && (!req || r.id !== req.id); });
      if (req && req.id) seer.requests.unshift(req);
      toast('Pedido enviado: "' + c.title + '"');
      refreshRequests();
    } catch (e) {
      seer.requests = seer.requests.filter(function (r) { return r !== fake; });
      if (e.status === 409) toast('Esse álbum já está na biblioteca');
      else if (e.status === 507) toast('Limite de armazenamento atingido');
      else toast('Erro ao pedir: ' + errMsg(e));
    }
    renderCurrentView();
  };
  window.seerArtistDiscography = function (ar, localAlbums) {
    if (!ar || String(ar.id).indexOf('x:') === 0 && !localAlbums.length) return '';
    var key = ar.name.toLowerCase();
    var d = disco[key];
    if (!d) setTimeout(function () { loadDiscography(ar); }, 0);
    var all = discoEntries(ar, localAlbums);
    var n = { all: all.length, available: 0, missing: 0 };
    all.forEach(function (e) { if (e.status === 'available') n.available++; else n.missing++; });
    var shown = all.filter(function (e) {
      return discoFilter === 'all' || (discoFilter === 'available' ? e.status === 'available' : e.status !== 'available');
    });
    function pill(f, label) {
      return '<button type="button" onclick="seerDiscoFilter(\'' + f + '\')" class="px-3.5 py-1.5 rounded-full text-xs font-bold transition ' +
        (discoFilter === f ? 'bg-[#3b8cff] text-black' : 'bg-white/[0.08] text-white hover:bg-white/[0.14]') + '">' + label + '</button>';
    }
    var jsKey = key.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    var cards = shown.map(function (e) {
      var c = e.cat, a = e.local;
      var title = a ? a.title : esc(c.title);
      var cover = a ? a.cover : caaCover(c.coverId || c.mbid, 250);
      var sub = (e.year && e.year !== '—' ? e.year : '') + (c && c.type ? ' · ' + esc(c.type) : (a && a.quality ? ' · ' + a.quality : ''));
      if (e.status === 'available') {
        var open = a ? 'openAlbumDetail(\'' + a.id + '\')' : (c.libraryId ? 'openAlbumDetail(\'' + c.libraryId + '\')' : '');
        return '<div ' + (open ? 'onclick="' + open + '" ' : '') + 'class="gt-card p-3.5 rounded-2xl cursor-pointer">' +
          '<img src="' + cover + '" alt="" loading="lazy" class="w-full aspect-square rounded-xl object-cover mb-2.5 bg-white/5" />' +
          '<div class="font-bold text-sm text-white truncate">' + title + '</div><div class="text-xs text-[#a7a7b0] truncate">' + sub + '</div></div>';
      }
      var badge = e.status === 'pending'
        ? '<span class="absolute top-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-amber-400 text-black">' + (e.req && e.req.status === 'downloading' ? 'Baixando' : 'Pedido') + '</span>'
        : '<span class="absolute top-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-black/70 text-white border border-white/20">Faltando</span>';
      var btn = e.status === 'missing'
        ? '<button type="button" onclick="event.stopPropagation(); seerRequestAlbum(\'' + jsKey + '\', \'' + c.mbid + '\')" class="absolute inset-x-2 bottom-2 py-2 rounded-full text-xs font-extrabold bg-[#3b8cff] text-black hover:bg-[#5aa0ff] transition sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100">+ Pedir Álbum</button>'
        : '';
      return '<div class="group p-3.5 rounded-2xl bg-white/[0.02] border border-dashed border-white/10">' +
        '<div class="relative mb-2.5"><img src="' + cover + '" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'" class="w-full aspect-square rounded-xl object-cover bg-white/5 grayscale opacity-50" />' + badge + btn + '</div>' +
        '<div class="font-bold text-sm text-white/70 truncate">' + title + '</div><div class="text-xs text-[#7a7a85] truncate">' + sub + '</div></div>';
    }).join('');
    var status = !d || d.state === 'loading'
      ? '<span class="text-xs text-[#a7a7b0] pulse-green">Buscando a discografia no MusicBrainz…</span>'
      : d.state === 'error' ? '<span class="text-xs text-amber-300">Discografia indisponível: ' + esc(d.error) + '</span>' : '';
    return '<div id="artist-discography"><div class="flex flex-wrap items-center justify-between gap-3 mb-3">' +
      '<h2 class="font-display font-bold text-lg text-white">Discografia</h2>' +
      '<div class="flex items-center gap-2">' + pill('all', 'Todos (' + n.all + ')') + pill('available', 'Na Biblioteca (' + n.available + ')') + pill('missing', 'Faltando (' + n.missing + ')') + '</div></div>' +
      (status ? '<div class="mb-3">' + status + '</div>' : '') +
      (cards ? '<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">' + cards + '</div>'
        : '<div class="text-sm text-[#a7a7b0] py-4">' + (discoFilter === 'missing' && d && d.state === 'ok' ? 'Nada faltando: você tem a discografia oficial inteira.' : 'Nenhum álbum aqui.') + '</div>') +
      '</div>';
  };

  async function refreshRequests() {
    if (!auth) return;
    try {
      var list = await apiJson('/api/seer/requests');
      var sorted = (list || []).slice().sort(function (a, b) {
        return String(b.createdAt).localeCompare(String(a.createdAt));
      });
      var sig = sorted.map(function (r) {
        return [r.id, r.status, r.source || '', r.error || '', r.updatedAt || ''].join('|');
      }).join('\n');
      var changed = sig !== seer.sig;
      seer.sig = sig;
      seer.requests = sorted;
      var becameAvailable = false;
      seer.requests.forEach(function (r) {
        var prev = seer.lastStatus[r.id];
        if (prev && prev !== 'available' && r.status === 'available') becameAvailable = true;
        seer.lastStatus[r.id] = r.status;
      });
      var active = seer.requests.filter(function (r) { return isActive(r.status); }).length;
      setText('nav-seer-badge', active + (active === 1 ? ' ativo' : ' ativos'));
      if (becameAvailable) scheduleReload(3000);
      if (changed && state.currentView === 'seer' && !document.activeElement.matches('#global-search-input')) renderCurrentView();
    } catch (e) { /* Guitarr pode estar desligado */ }
  }

  async function seerSearch() {
    var q = state.searchQuery.trim();
    seer.q = q;
    seer.detail = null;
    if (!q) { seer.results = []; seer.loading = false; seer.error = ''; seerRefresh(); return; }
    seer.loading = true; seer.error = ''; seerRefresh();
    try {
      var res = await apiJson('/api/seer/catalog?q=' + encodeURIComponent(q) + '&limit=20');
      if (seer.q !== q) return;
      seer.results = res || [];
    } catch (e) {
      if (seer.q !== q) return;
      seer.results = [];
      seer.error = e.status === 502 ? 'O MusicBrainz não respondeu. Tente de novo em instantes.' : errMsg(e);
    }
    seer.loading = false;
    seerRefresh();
  }

  // Nas telas da biblioteca, o catálogo do MusicBrainz aparece embaixo dos resultados locais,
  // só com o que ainda não está na biblioteca, para pedir dali mesmo.
  var CAT_VIEWS = { songs: 1, albums: 1, artists: 1 };
  function seerRefresh() {
    if (CAT_VIEWS[state.currentView]) drawCatalogBlock(); else renderCurrentView();
  }
  function drawCatalogBlock() {
    var old = $('seer-cat-block');
    if (old) old.remove();
    var q = state.searchQuery.trim();
    var c = $('view-content');
    if (!c || !q || !CAT_VIEWS[state.currentView]) return;
    if (seer.q !== q && !seer.loading) { clearTimeout(seer.timer); seer.timer = setTimeout(seerSearch, 0); }
    var body;
    var items = seer.q === q ? (seer.results || []).filter(function (it) { return !it.inLibrary; }) : [];
    seer.shown = items;
    if (seer.loading || seer.q !== q) body = '<div class="py-6 text-center text-sm text-[#a7a7b0] pulse-green">Buscando no catálogo…</div>';
    else if (seer.error) body = '<div class="py-6 text-center text-sm text-red-400">' + esc(seer.error) + '</div>';
    else if (!items.length) body = '<div class="py-6 text-center text-sm text-[#a7a7b0]">Nada novo no catálogo para esta busca.</div>';
    else body = items.map(seerRow).join('');
    c.insertAdjacentHTML('beforeend', '<div id="seer-cat-block" class="mt-8 pt-6 border-t border-white/[0.06] space-y-1">' +
      '<h2 class="font-display font-bold text-lg text-white">Do catálogo (MusicBrainz)</h2>' +
      '<p class="text-xs text-[#a7a7b0] pb-2">Não está na biblioteca: peça para baixar</p>' + body + '</div>');
  }

  var origHandleGlobalSearch = window.handleGlobalSearch;
  window.handleGlobalSearch = function (val) {
    state.searchQuery = val || '';
    var clearBtn = $('clear-search-btn');
    if (clearBtn) clearBtn.classList.toggle('hidden', state.searchQuery.length === 0);
    if (state.currentView === 'seer') {
      clearTimeout(seer.timer);
      seer.timer = setTimeout(seerSearch, 450);
    } else if (state.currentView === 'podcasts') {
      clearTimeout(pod.timer);
      pod.timer = setTimeout(podSearch, 450);
    } else if (state.currentView === 'radios') {
      clearTimeout(radio.timer);
      radio.timer = setTimeout(radioSearch, 450);
    } else {
      renderCurrentView();
      clearTimeout(seer.timer);
      if (CAT_VIEWS[state.currentView] && state.searchQuery.trim()) seer.timer = setTimeout(seerSearch, 450);
    }
  };

  window.seerOpenDetail = async function (i) {
    var item = seer.shown[i];
    if (!item) return;
    if (item.inLibrary && item.libraryId) return window.seerOpenLibrary(i);
    if (item.kind !== 'artist' && item.kind !== 'album') return;
    seer.loading = true; seer.error = ''; seerRefresh();
    try {
      var d = await apiJson('/api/seer/catalog/' + item.kind + '/' + encodeURIComponent(item.mbid));
      seer.detail = { kind: item.kind, head: d[item.kind], items: item.kind === 'artist' ? d.albums : d.tracks };
    } catch (e) { seer.error = errMsg(e); }
    seer.loading = false;
    if (state.currentView !== 'seer') switchView('seer'); else renderCurrentView();
  };
  window.seerBack = function () { seer.detail = null; renderCurrentView(); };

  window.seerOpenLibrary = function (i) {
    var item = seer.shown[i];
    if (!item || !item.libraryId) return;
    if (item.kind === 'album') {
      state.selectedAlbumId = item.libraryId; switchView('albumDetail');
    } else if (item.kind === 'artist') {
      var ar = ARTISTS.find(function (a) { return a.id === item.libraryId; });
      if (ar) { state.selectedArtistName = ar.name; switchView('artistDetail'); }
    } else {
      var idx = TRACKS.findIndex(function (t) { return t.id === item.libraryId; });
      if (idx >= 0) { queue = null; startTrack(idx); } else toast('Faixa ainda não apareceu na biblioteca');
    }
  };

  window.seerRequest = async function (i) {
    var item = seer.shown[i];
    if (!item) return;
    try {
      var req = await apiJson('/api/seer/requests', { method: 'POST', json: item });
      if (req && req.id) {
        seer.requests = seer.requests.filter(function (r) { return r.id !== req.id; });
        seer.requests.unshift(req);
        seer.lastStatus[req.id] = req.status;
      }
      toast('Pedido enviado: "' + (item.title || '') + '"');
      refreshRequests();
    } catch (e) {
      if (e.status === 409) toast('Isso já está na biblioteca');
      else if (e.status === 507) toast('Limite de armazenamento atingido');
      else toast('Erro ao pedir: ' + errMsg(e));
    }
    renderCurrentView();
  };
  window.seerRetryAll = async function () {
    var failed = seer.requests.filter(function (r) { return r.status === 'failed'; });
    if (!failed.length) { toast('Nenhum pedido com falha'); return; }
    var ok = 0, bad = 0;
    for (var i = 0; i < failed.length; i++) {
      try { await api('/api/seer/requests/' + encodeURIComponent(failed[i].id) + '/approve', { method: 'POST' }); ok++; }
      catch (e) { bad++; }
    }
    toast(ok + (ok === 1 ? ' pedido reenfileirado' : ' pedidos reenfileirados') +
      ' por outro caminho' + (bad ? ' · ' + bad + ' não foram aceitos' : ''));
    refreshRequests();
  };
  window.seerApprove = async function (id) {
    try { await api('/api/seer/requests/' + encodeURIComponent(id) + '/approve', { method: 'POST' }); toast('Pedido aprovado'); }
    catch (e) { toast('Erro ao aprovar: ' + errMsg(e)); }
    refreshRequests();
  };

  function seerRow(item, idx) {
    var cov = (item.kind === 'artist') ? '' : caaCover(item.coverId, 250);
    var img = cov
      ? '<img src="' + cov + '" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'" class="w-11 h-11 rounded-lg object-cover flex-shrink-0 bg-white/5" />'
      : '<div class="w-11 h-11 rounded-full flex-shrink-0 bg-white/10 flex items-center justify-center text-[#3b8cff] font-black">' + esc((item.title || '?').charAt(0).toUpperCase()) + '</div>';
    var typeLabel = item.kind === 'artist' ? 'Artista' : item.kind === 'album' ? (item.type || 'Álbum') : 'Faixa';
    var sub = item.kind === 'artist'
      ? esc([item.type, item.country, item.disambiguation].filter(Boolean).join(' · '))
      : esc(item.artist || '') + (item.album && item.kind === 'track' ? ' · ' + esc(item.album) : '') + (item.year ? ' (' + item.year + ')' : '');
    var dur = item.durationMs ? fmtDur(item.durationMs / 1000) : '';
    var rq = reqFor(item);
    var btn;
    if (item.inLibrary) {
      btn = '<button type="button" onclick="event.stopPropagation(); seerOpenLibrary(' + idx + ')" class="px-3.5 py-1.5 rounded-full text-xs font-bold bg-white/10 hover:bg-white/20 text-[#3b8cff]">✓ Na Biblioteca</button>';
    } else if (rq) {
      btn = '<span class="px-3.5 py-1.5 rounded-full text-xs font-bold bg-[#3b8cff]/20 text-[#3b8cff] ' + (isActive(rq.status) ? 'pulse-green' : '') + '">' + esc(STATUS_LABEL[rq.status] || rq.status) + '</span>';
    } else if (item.kind === 'artist') {
      btn = '<span class="text-xs font-bold text-[#3b8cff]">Ver Discografia →</span>';
    } else {
      btn = '<button type="button" onclick="event.stopPropagation(); seerRequest(' + idx + ')" class="px-4 py-1.5 rounded-full text-xs font-extrabold bg-[#3b8cff] hover:bg-[#5aa0ff] text-black transition shadow">+ Pedir</button>';
    }
    var clickable = item.kind === 'artist' || item.kind === 'album';
    return '<div ' + (clickable ? 'onclick="seerOpenDetail(' + idx + ')" ' : '') +
      'class="flex items-center justify-between gap-3 p-2.5 rounded-xl hover:bg-white/[0.06] transition ' + (clickable ? 'cursor-pointer' : '') + '">' +
      '<div class="flex items-center gap-3 min-w-0">' + img +
      '<div class="min-w-0"><div class="text-sm font-bold text-white truncate flex items-center gap-2"><span class="truncate">' + esc(item.title) + '</span>' +
      '<span class="text-[10px] px-2 py-0.5 rounded bg-white/10 text-[#a7a7b0] font-semibold flex-shrink-0">' + esc(typeLabel) + '</span></div>' +
      '<div class="text-xs text-[#a7a7b0] truncate">' + sub + '</div></div></div>' +
      '<div class="flex items-center gap-2 flex-shrink-0"><span class="text-xs font-mono text-[#a7a7b0] hidden sm:inline">' + dur + '</span>' + btn + '</div></div>';
  }

  window.renderSeerView = function () {
    var q = state.searchQuery.trim();
    seer.shown = [];
    var list = '';
    var heading = 'Catálogo Global (Peça com 1 Clique)';
    if (seer.loading) {
      list = '<div class="py-10 text-center text-sm text-[#a7a7b0] pulse-green">Buscando no MusicBrainz…</div>';
    } else if (seer.error) {
      list = '<div class="py-10 text-center text-sm text-red-400">' + esc(seer.error) + '</div>';
    } else if (seer.detail) {
      var d = seer.detail;
      heading = (d.kind === 'artist' ? 'Discografia · ' : 'Faixas · ') + esc(d.head && d.head.title || '');
      d.items.forEach(function (it) { seer.shown.push(it); });
      list = '<button type="button" onclick="seerBack()" class="text-xs font-bold text-[#3b8cff] hover:underline mb-2 px-2">← Voltar aos resultados</button>' +
        seer.shown.map(seerRow).join('');
      if (!seer.shown.length) list += '<div class="py-8 text-center text-sm text-[#a7a7b0]">Nada encontrado.</div>';
    } else if (q) {
      seer.results.forEach(function (it) { seer.shown.push(it); });
      list = seer.shown.map(seerRow).join('');
      if (!seer.shown.length) list = '<div class="py-10 text-center text-sm text-[#a7a7b0]">Nenhum resultado para "' + esc(q) + '".</div>';
    } else {
      list = '<div class="py-10 text-center text-sm text-[#a7a7b0]">Digite um artista, álbum ou música na busca acima para pesquisar no catálogo mundial.</div>';
    }

    var storageBtn = seer.storage
      ? 'Espaço & Duplicatas (' + fmtBytes(seer.storage.used) + (seer.storage.limit ? ' / ' + fmtBytes(seer.storage.limit) : '') + ')'
      : 'Espaço & Duplicatas';

    var reqs = seer.requests.length ? seer.requests.map(function (r) {
      var st = r.status;
      var chip = st === 'available' ? 'bg-[#3b8cff]/20 text-[#3b8cff]' : st === 'failed' ? 'bg-red-500/20 text-red-300' : 'bg-amber-500/20 text-amber-300';
      var bar = st === 'failed' ? 'bg-red-500' : 'bg-[#3b8cff]';
      var action = (auth.isAdmin && (st === 'pending' || st === 'failed'))
        ? '<button type="button" onclick="seerApprove(\'' + r.id + '\')" class="mt-2 px-3 py-1 rounded-full text-[11px] font-extrabold bg-[#3b8cff] text-black hover:bg-[#5aa0ff]">' + (st === 'failed' ? 'Tentar de novo (outro caminho)' : 'Aprovar') + '</button>' : '';
      var cov = r.kind === 'artist' ? '' : caaCover(r.mbid, 250);
      return '<div class="bg-[#18181f] border border-white/[0.06] rounded-2xl p-4 flex items-center gap-4">' +
        (r.kind === 'album' && cov ? '<img src="' + cov + '" alt="" loading="lazy" class="w-14 h-14 rounded-xl object-cover flex-shrink-0 shadow bg-white/5" />'
          : '<div class="w-14 h-14 rounded-xl flex-shrink-0 bg-white/10 flex items-center justify-center text-[#3b8cff] text-xl">♪</div>') +
        '<div class="flex-1 min-w-0"><div class="flex items-center justify-between gap-2">' +
        '<div class="font-bold text-sm text-white truncate">' + esc(r.title) + '</div>' +
        '<span class="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase whitespace-nowrap ' + chip + '">' + esc(STATUS_LABEL[st] || st) + '</span></div>' +
        '<div class="text-xs text-[#a7a7b0] truncate">' + esc(r.artist) + (r.album && r.kind === 'track' ? ' · ' + esc(r.album) : '') + (r.source ? ' · ' + esc(r.source) : '') + '</div>' +
        '<div class="w-full h-1.5 bg-white/10 rounded-full overflow-hidden mt-2"><div class="h-full ' + bar + ' rounded-full transition-all duration-500' + (isActive(st) ? ' pulse-green' : '') + '" style="width:' + (STATUS_PCT[st] || 10) + '%"></div></div>' +
        (r.error ? '<div class="text-[11px] text-red-300 mt-1 truncate" title="' + esc(r.error) + '">' + esc(r.error) + '</div>' : '') + action +
        '</div></div>';
    }).join('') : '<div class="text-sm text-[#a7a7b0] py-6">Nenhum pedido ainda. Pesquise acima e peça o que falta na biblioteca.</div>';

    var nFailed = seer.requests.filter(function (r) { return r.status === 'failed'; }).length;
    var retryAll = (auth.isAdmin && nFailed)
      ? '<button type="button" onclick="seerRetryAll()" class="px-3.5 py-1.5 rounded-full text-[11px] font-extrabold bg-[#3b8cff] text-black hover:bg-[#5aa0ff] transition">↻ Tentar de novo todos (' + nFailed + ')</button>'
      : '';
    var nDone = seer.requests.filter(function (r) { return r.status === 'available' || r.status === 'failed'; }).length;
    var clearDone = nDone
      ? '<button type="button" onclick="seerClearFinished()" title="Tira da lista os pedidos concluídos e os que falharam (as músicas ficam)" class="px-3.5 py-1.5 rounded-full text-[11px] font-bold bg-white/10 hover:bg-white/15 text-white transition">Limpar concluídos (' + nDone + ')</button>'
      : '';
    return '<div class="space-y-6 pb-8">' +
      '<div class="relative overflow-hidden rounded-2xl p-6 sm:p-8 border border-white/10 bg-gradient-to-br from-[#10281c] via-[#16132b] to-[#121218]">' +
      '<div class="relative z-10 max-w-2xl"><div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#3b8cff]/20 text-[#3b8cff] text-xs font-bold mb-3">Catálogo MusicBrainz · Soulseek + YouTube + SoundCloud</div>' +
      '<h1 class="font-display font-black text-3xl sm:text-4xl text-white tracking-tight">Pedidos sob Demanda</h1>' +
      '<p class="text-xs sm:text-sm text-zinc-300 mt-2 leading-relaxed">Pesquise qualquer artista, álbum ou música. O que já está na biblioteca toca na hora; o que falta é baixado automaticamente e entra na biblioteca com as tags do MusicBrainz.</p>' +
      '<div class="flex flex-wrap gap-2.5 mt-4">' +
      '<button type="button" onclick="openImportPlaylistModal()" class="px-4 py-2 rounded-full text-xs font-extrabold bg-[#3b8cff] text-black hover:bg-[#5aa0ff] transition">+ Importar Playlists / CSV</button>' +
      '<button type="button" onclick="openStorageModal()" class="px-4 py-2 rounded-full text-xs font-bold bg-white/10 hover:bg-white/15 text-white transition">' + esc(storageBtn) + '</button>' +
      '</div></div></div>' +
      '<div><h2 class="font-display font-bold text-base text-white mb-2.5">' + heading + '</h2>' +
      '<div class="bg-[#18181f] rounded-2xl p-3 border border-white/[0.05] space-y-1.5">' + list + '</div></div>' +
      '<div><div class="flex items-center justify-between mb-3"><h2 class="font-display font-bold text-lg text-white">Fila de Downloads & Aquisições</h2>' +
      '<div class="flex items-center gap-3">' + retryAll + clearDone + '<span class="text-xs text-[#a7a7b0]">atualiza sozinha</span></div></div>' +
      '<div class="grid grid-cols-1 md:grid-cols-2 gap-3">' + reqs + '</div></div></div>';
  };

  window.seerClearFinished = async function () {
    if (!window.confirm('Tirar da fila os pedidos concluídos e os que falharam?' + (auth.isAdmin ? ' (de todos os usuários)' : '') + '\nAs músicas baixadas continuam na biblioteca.')) return;
    try {
      var r = await apiJson('/api/seer/requests?status=available,failed', { method: 'DELETE' });
      toast((r && r.removed || 0) + ' pedidos removidos da fila');
      refreshRequests();
    } catch (e) { toast('Erro ao limpar: ' + errMsg(e)); }
  };

  // --- storage + duplicatas
  var storageChanged = false;
  window.openStorageModal = async function () {
    showModal('modal-storage');
    storageChanged = false;
    try {
      var s = await apiJson('/api/seer/storage');
      seer.storage = s;
      var totalGB = Math.max(10, Math.ceil(s.diskTotal / 1e9));
      var slider = $('storage-limit-slider');
      slider.min = 10; slider.max = totalGB; slider.step = 10;
      slider.value = s.limit ? Math.min(totalGB, Math.max(10, Math.round(s.limit / 1e9))) : totalGB;
      slider.disabled = !auth.isAdmin;
      setText('modal-used-val', fmtBytes(s.used));
      setText('modal-limit-val', s.limit ? fmtBytes(s.limit) : 'Sem limite');
      setText('modal-disk-total', 'Disco total: ' + fmtBytes(s.diskTotal));
      setText('modal-disk-free', fmtBytes(s.diskFree) + ' livres (mínimo livre: ' + fmtBytes(s.minFree) + ')');
      updateSidebarStorage();
    } catch (e) { toast('Erro ao ler o armazenamento: ' + errMsg(e)); }
    var list = $('duplicates-list'), btn = $('btn-clean-dups');
    if (!auth.isAdmin) {
      list.innerHTML = '<div class="p-2 text-[#a7a7b0]">Somente administradores veem e limpam duplicatas.</div>';
      btn.style.display = 'none';
      return;
    }
    btn.style.display = '';
    list.innerHTML = '<div class="p-2 text-[#a7a7b0]">Procurando duplicatas…</div>';
    try {
      var d = await apiJson('/api/seer/duplicates');
      var groups = d.groups || [];
      setText('dup-badge-sidebar', groups.length + (groups.length === 1 ? ' duplicata' : ' duplicatas'));
      btn.textContent = groups.length ? 'Limpar Duplicatas (' + fmtBytes(d.bytes) + ')' : 'Nenhuma duplicata';
      btn.disabled = !groups.length;
      list.innerHTML = groups.length ? groups.slice(0, 50).map(function (g) {
        return '<div class="flex items-center justify-between p-2 rounded-lg bg-white/[0.04]"><div class="min-w-0">' +
          '<div class="font-bold text-white truncate">' + esc(g.artist) + ' — ' + esc(g.title) + '</div>' +
          '<div class="text-[11px] text-[#a7a7b0] truncate">' + esc(g.album) + ' · ' + ((g.files || []).length) + ' cópias</div></div>' +
          '<span class="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[10px] font-bold">Duplicada</span></div>';
      }).join('') + (groups.length > 50 ? '<div class="text-[11px] text-[#a7a7b0] text-center py-1">Mostrando 50 de ' + groups.length + '. Limpar remove todas.</div>' : '')
        : '<div class="p-3 rounded-xl bg-[#3b8cff]/15 text-[#3b8cff] font-bold text-center">✓ Nenhuma música duplicada.</div>';
    } catch (e) { list.innerHTML = '<div class="p-2 text-red-300">' + esc(errMsg(e)) + '</div>'; }
  };
  window.updateStorageLimitPreview = function (val) {
    storageChanged = true;
    var s = $('storage-limit-slider');
    var atMax = parseFloat(val) >= parseFloat(s.max);
    var label = atMax ? 'Sem limite' : val + ' GB';
    setText('modal-limit-val', label);
    setText('storage-limit-label', label);
  };
  window.saveStorageAndClose = async function () {
    if (storageChanged && auth.isAdmin) {
      var s = $('storage-limit-slider');
      var atMax = parseFloat(s.value) >= parseFloat(s.max);
      try {
        await api('/api/seer/storage', { method: 'PUT', json: { limit: atMax ? 0 : Math.round(parseFloat(s.value) * 1e9) } });
        toast('Limite de armazenamento salvo');
      } catch (e) { toast('Erro ao salvar o limite: ' + errMsg(e)); }
      storageChanged = false;
      refreshStorage();
    }
    window.closeModal('modal-storage');
  };
  window.cleanDuplicates = async function () {
    if (!window.confirm('Mover as cópias duplicadas para a lixeira do Guitarr (apagadas após 7 dias)?')) return;
    try {
      var d = await apiJson('/api/seer/duplicates/clean', { method: 'POST' });
      toast('Duplicatas movidas para a lixeira (' + fmtBytes(d && d.bytes) + ' liberados)');
      scheduleReload(8000);
      window.openStorageModal();
    } catch (e) { toast('Erro ao limpar: ' + errMsg(e)); }
  };
  function updateSidebarStorage() {
    var s = seer.storage;
    if (!s) return;
    setText('storage-used-label', fmtBytes(s.used));
    setText('storage-limit-label', s.limit ? fmtBytes(s.limit) : 'sem limite');
    var pct = s.limit ? Math.min(100, (s.used / s.limit) * 100) : (s.diskTotal ? Math.min(100, (s.used / s.diskTotal) * 100) : 0);
    var bar = $('storage-bar-fill'); if (bar) bar.style.width = Math.max(2, pct).toFixed(0) + '%';
    setText('sidebar-disk-free', fmtBytes(s.diskFree) + ' livres no disco');
    var mb = $('mobile-storage-btn'); if (mb) mb.textContent = fmtBytes(s.used) + ' / Duplicatas';
  }
  async function refreshStorage() {
    try { seer.storage = await apiJson('/api/seer/storage'); updateSidebarStorage(); } catch (e) {}
  }

  // --- importar playlist (link ou arquivo CSV/JSON/TXT/ZIP do Exportify e afins)
  var importMode = 'link';
  var LIKED_RE = /^(liked[ _-]?songs|your[ _-]?likes|liked[ _-]?music|m[uú]sicas[ _-]?curtidas|curtidas)(\.[a-z]+)?$/i;
  window.setImportMode = function (mode) {
    importMode = mode;
    var on = 'flex-1 py-1.5 rounded-full bg-white/[0.12] text-white', off = 'flex-1 py-1.5 rounded-full text-[#a7a7b0] hover:text-white';
    $('import-tab-link').className = mode === 'link' ? on : off;
    $('import-tab-file').className = mode === 'file' ? on : off;
    $('import-link-box').classList.toggle('hidden', mode !== 'link');
    $('import-file-box').classList.toggle('hidden', mode !== 'file');
    $('import-sync-box').classList.toggle('hidden', mode !== 'link');
    $('import-target-auto').hidden = mode !== 'file';
    var sel = $('import-target-select');
    if (mode === 'link' && sel.value === 'auto') sel.value = 'playlist';
    if (mode === 'file') window.onImportFiles($('import-file-input'));
    else $('import-name-box').classList.remove('hidden');
  };
  window.onImportFiles = function (input) {
    var files = Array.prototype.slice.call(input.files || []);
    var many = files.length > 1 || files.some(function (f) { return /\.zip$/i.test(f.name); });
    $('import-file-label').textContent = !files.length ? 'Escolher arquivos .csv, .json, .txt ou .zip'
      : files.length === 1 ? files[0].name : files.length + ' arquivos selecionados';
    $('import-name-box').classList.toggle('hidden', many);
    var sel = $('import-target-select');
    if (many) sel.value = 'auto';
    else if (files.length === 1) sel.value = LIKED_RE.test(files[0].name) ? 'favorites' : (sel.value === 'auto' ? 'playlist' : sel.value);
  };
  window.openImportPlaylistModal = function () {
    var m = $('modal-import');
    m.classList.remove('hidden'); m.classList.add('flex');
    window.setImportMode(importMode);
  };
  window.submitPlaylistImport = async function (e) {
    e.preventDefault();
    var target = $('import-target-select').value;
    var name = $('import-name-input').value.trim();
    var btn = $('import-submit-btn');
    try {
      var res;
      if (importMode === 'file') {
        var files = $('import-file-input').files;
        if (!files || !files.length) { toast('Escolha um arquivo CSV exportado (Exportify, TuneMyMusic…).'); return; }
        var fd = new FormData();
        for (var i = 0; i < files.length; i++) fd.append('file', files[i], files[i].name);
        fd.append('target', target);
        if (name) fd.append('name', name);
        btn.disabled = true; btn.textContent = 'Enviando…';
        res = await apiJson('/api/seer/imports', { method: 'POST', form: fd });
      } else {
        var url = $('import-url-input').value.trim();
        if (!url) { toast('Cole o link de uma playlist ou álbum.'); return; }
        res = await apiJson('/api/seer/imports', { method: 'POST', json: { url: url, sync: $('import-sync-check').checked, target: target } });
      }
      window.closeModal('modal-import');
      $('import-url-input').value = ''; $('import-name-input').value = '';
      $('import-file-input').value = ''; window.onImportFiles($('import-file-input'));
      var jobs = Array.isArray(res) ? res : (res ? [res] : []);
      var fav = jobs.filter(function (j) { return j.target === 'favorites' || j.target === 'both'; }).length;
      toast(jobs.length > 1
        ? jobs.length + ' importações iniciadas' + (fav ? ' (' + fav + ' para Favoritos)' : '') + '. Faixas faltantes serão pedidas.'
        : 'Importação iniciada' + (jobs[0] && jobs[0].name ? ': "' + jobs[0].name + '"' : '') +
          (fav ? ' → Favoritos' : '') + '. Faixas faltantes serão pedidas.');
      refreshRequests();
      scheduleReload(10000);
    } catch (err) { toast('Erro ao importar: ' + errMsg(err)); }
    finally { btn.disabled = false; btn.textContent = 'Importar e Baixar Faltantes'; }
  };

  // --- tema (theme.js no <head>): vale neste navegador e vai para /api/seer/state (chave theme),
  // que o app mobile também lê.
  function themeChips() {
    var th = window.seerTheme;
    if (!th) return '';
    var cur = th.get();
    return ['dark', 'oled', 'light'].map(function (t) {
      return '<button type="button" onclick="seerSetTheme(\'' + t + '\')" class="flex-1 px-2 py-1.5 rounded-lg text-xs font-bold transition ' +
        (cur === t ? 'bg-[#3b8cff] text-black' : 'bg-white/[0.08] hover:bg-white/[0.14] text-white') + '" title="' + th.names[t] + '">' + th.short[t] + '</button>';
    }).join('');
  }
  window.seerSetTheme = function (t) {
    if (!window.seerTheme) return;
    window.seerTheme.set(t);
    api('/api/seer/state', { method: 'PUT', json: { theme: { name: t } } }).catch(function () {});
    document.querySelectorAll('[data-theme-row]').forEach(function (row) { row.innerHTML = themeChips(); });
  };

  // --- idioma (i18n.js no <head>): vale neste navegador e vai para /api/seer/state (chave prefs),
  // que o app mobile também lê.
  window.seerPickLang = function (l) {
    var saved = auth ? api('/api/seer/state', { method: 'PUT', json: { prefs: { lang: l } } }).catch(function () {}) : Promise.resolve();
    saved.then(function () { window.seerSetLang(l); });
  };

  // --- servidor / conta
  // Menu da conta (avatar no topo): tema, Configurações, passeio e sair.
  window.openServerModal = function (ev) {
    var old = $('seer-account-menu');
    if (old) { old.remove(); return; }
    var btn = ev && ev.currentTarget;
    var r = btn && btn.getBoundingClientRect ? btn.getBoundingClientRect() : { right: window.innerWidth - 16, bottom: 56 };
    var item = 'w-full text-left px-3.5 py-2.5 rounded-lg text-sm font-semibold text-white hover:bg-white/[0.08] transition flex items-center gap-2.5';
    var m = document.createElement('div');
    m.id = 'seer-account-menu';
    m.className = 'fixed z-50 w-60 p-1.5 rounded-xl bg-[#1b1b22] border border-white/10 shadow-2xl';
    m.style.top = (r.bottom + 8) + 'px';
    m.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
    m.innerHTML = '<div class="px-3.5 py-2 border-b border-white/10 mb-1"><div class="text-sm font-bold text-white truncate">' + esc((auth && (auth.name || auth.username)) || '') + '</div>' +
      '<div class="text-[11px] text-[#a7a7b0] truncate">' + esc(location.host) + (auth && auth.isAdmin ? ' · admin' : '') + '</div></div>' +
      '<div class="px-2 pt-1 pb-2 border-b border-white/10 mb-1"><div class="text-[11px] font-bold text-[#a7a7b0] px-1.5 mb-1.5">Tema</div>' +
      '<div data-theme-row class="flex gap-1">' + themeChips() + '</div></div>' +
      '<div class="px-2 pt-1 pb-2 border-b border-white/10 mb-1"><div class="text-[11px] font-bold text-[#a7a7b0] px-1.5 mb-1.5">Idioma</div>' +
      '<div class="flex gap-1">' + window.seerLangChips() + '</div></div>' +
      (auth && auth.isAdmin ? '<button type="button" data-a="cfg" class="' + item + '">⚙ Configurações</button>' : '') +
      '<button type="button" data-a="tour" class="' + item + '">✦ Rever o passeio</button>' +
      '<button type="button" data-a="out" class="' + item + ' text-red-300">⎋ Sair</button>';
    document.body.appendChild(m);
    m.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-a]'); if (!b) return;
      m.remove();
      if (b.dataset.a === 'cfg') window.switchView('cfg');
      else if (b.dataset.a === 'tour') window.seerTourStart();
      else if (window.confirm('Sair da conta ' + (auth && auth.username) + '?')) logout();
    });
    setTimeout(function () {
      document.addEventListener('mousedown', function close(e) {
        if (!m.contains(e.target) && (!btn || !btn.contains(e.target))) { m.remove(); }
        if (!document.body.contains(m)) document.removeEventListener('mousedown', close);
      });
    }, 0);
  };

  // ------------------------------------------------------ podcasts e rádios ---
  var pod = { channels: [], episodes: {}, open: null, loading: false, error: '',
    q: '', src: 'all', found: [], searching: false, searchErr: '', timer: null, more: {} };

  async function loadPodcasts() {
    pod.loading = true; pod.error = '';
    try { pod.channels = (await apiJson('/api/seer/podcasts')) || []; }
    catch (e) { pod.error = errMsg(e); pod.channels = []; }
    pod.loading = false;
    if (state.currentView === 'podcasts') renderCurrentView();
  }
  async function loadEpisodes(id) {
    try {
      var d = await apiJson('/api/seer/podcasts/' + encodeURIComponent(id));
      var eps = Array.isArray(d) ? d : (d && (d.episodes || d.Episodes)) || [];
      pod.episodes[id] = eps;
    } catch (e) { pod.episodes[id] = []; toast('Erro ao abrir o canal: ' + errMsg(e)); }
    renderCurrentView();
  }
  window.togglePodcast = function (id) {
    pod.open = pod.open === id ? null : id;
    if (pod.open && !pod.episodes[id]) loadEpisodes(id); else renderCurrentView();
  };
  window.playEpisode = function (chId, epId) {
    var ch = pod.channels.find(function (c) { return c.id === chId; });
    var ep = (pod.episodes[chId] || []).find(function (x) { return x.id === epId; });
    if (!ep) return;
    ext = { title: esc(ep.title), subtitle: esc(ch ? ch.title : (ep.channelTitle || 'Podcast')), cover: ch && ch.imageUrl || '', live: false };
    loadedKey = 'ep:' + ep.id;
    audio.src = '/api/seer/podcasts/episodes/' + encodeURIComponent(ep.id) + '/stream?jwt=' + encodeURIComponent(auth.token);
    state.isPlaying = true;
    updateMediaSession(ext.title, ext.subtitle, '', ext.cover);
    updatePlayerUI(); syncAudio();
    toast('Reproduzindo: ' + ext.title);
  };
  window.downloadEpisode = async function (chId, epId) {
    try {
      await api('/api/seer/podcasts/episodes/' + encodeURIComponent(epId) + '/download', { method: 'POST' });
      toast('Download do episódio iniciado');
      setTimeout(function () { loadEpisodes(chId); }, 4000);
    } catch (e) { toast('Erro: ' + errMsg(e)); }
  };
  window.syncAllPodcasts = async function () {
    try { await api('/api/seer/podcasts/refresh-all', { method: 'POST' }); toast('Verificando todos os canais…'); setTimeout(loadPodcasts, 5000); }
    catch (e) { toast('Erro: ' + errMsg(e)); }
  };
  window.addDemoPodcast = async function () {
    var url = window.prompt('Link do feed RSS, canal ou playlist do YouTube (ou digite o nome para buscar):');
    if (!url) return;
    if (!/^https?:\/\//i.test(url.trim())) { // nome, não link: busca como na caixa do topo
      var inp = $('global-search-input');
      if (inp) inp.value = url.trim();
      window.handleGlobalSearch(url.trim());
      return;
    }
    addPodcastWithRetention(url.trim(), { url: url.trim(), feedUrl: url.trim() });
  };
  // Busca de podcasts (Apple Podcasts / YouTube) pela caixa de busca do topo; seguir grava o canal.
  async function podSearch() {
    var q = state.searchQuery.trim();
    pod.q = q;
    if (!q) { pod.found = []; pod.searching = false; pod.searchErr = ''; renderCurrentView(); return; }
    pod.searching = true; pod.searchErr = ''; renderCurrentView();
    try {
      var res = await apiJson('/api/seer/podcasts/search?q=' + encodeURIComponent(q) + '&source=' + encodeURIComponent(pod.src) + '&limit=15');
      if (pod.q !== q) return;
      pod.found = res || [];
    } catch (e) {
      if (pod.q !== q) return;
      pod.found = []; pod.searchErr = 'A busca falhou: ' + errMsg(e);
    }
    pod.searching = false;
    renderCurrentView();
  }
  window.podSetSource = function (v) { pod.src = v; podSearch(); };
  window.podFollow = async function (i) {
    var r = pod.found[i];
    if (!r) return;
    var key = r.feedUrl || r.url;
    if (!key) return;
    addPodcastWithRetention(r.title || key, { url: key, sourceType: r.sourceType || '' });
  };
  function podSearchHtml() {
    var chips = [['all', 'Todos'], ['rss', 'Apple Podcasts'], ['youtube', 'YouTube']].map(function (x) {
      return '<button type="button" onclick="podSetSource(\'' + x[0] + '\')" class="px-3 py-1 rounded-full text-[11px] font-bold ' +
        (pod.src === x[0] ? 'bg-[#3b8cff] text-black' : 'bg-white/10 text-white hover:bg-white/15') + '">' + x[1] + '</button>';
    }).join('');
    var body;
    if (pod.searching) body = '<div class="text-sm text-[#a7a7b0] pulse-green">Buscando podcasts…</div>';
    else if (pod.searchErr) body = '<div class="text-sm text-red-300">' + esc(pod.searchErr) + '</div>';
    else if (!pod.found.length) body = '<div class="text-sm text-[#a7a7b0]">Nenhum podcast encontrado.</div>';
    else body = '<div class="space-y-2">' + pod.found.map(function (r, i) {
      var key = r.feedUrl || r.url;
      var following = pod.channels.some(function (c) { return c.feedUrl === key || c.url === key; });
      var act = following
        ? '<span class="text-[11px] font-bold text-[#3b8cff] flex-shrink-0">Seguindo ✓</span>'
        : '<button type="button" onclick="podFollow(' + i + ')" class="px-3 py-1.5 rounded-full text-[11px] font-extrabold bg-[#3b8cff] text-black hover:bg-[#5aa0ff] flex-shrink-0">+ Seguir</button>';
      return '<div class="flex items-center gap-3 p-3 rounded-xl bg-black/40">' +
        (r.imageUrl ? '<img src="' + esc(r.imageUrl) + '" alt="" loading="lazy" class="w-12 h-12 rounded-lg object-cover bg-white/5 flex-shrink-0" />'
          : '<div class="w-12 h-12 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">🎙</div>') +
        '<div class="min-w-0 flex-1"><div class="text-sm font-bold text-white truncate">' + esc(r.title || '') + '</div>' +
        '<div class="text-[11px] text-[#a7a7b0] truncate">' + esc(r.author || '') + ' · ' + (r.sourceType === 'youtube' ? 'YouTube' : 'RSS') + '</div></div>' + act + '</div>';
    }).join('') + '</div>';
    return '<div class="bg-[#18181f] border border-white/[0.06] rounded-2xl p-5 space-y-4">' +
      '<div class="flex flex-wrap items-center justify-between gap-3"><div class="text-sm font-bold text-white">Resultados para "' + esc(pod.q) + '"</div>' +
      '<div class="flex gap-1.5">' + chips + '</div></div>' + body + '</div>';
  }

  var KEEP_OPTIONS = [
    [-1, 'Apenas manual', 'Não baixa nada sozinho. Você escolhe os episódios um a um.'],
    [1, 'Manter apenas o último', 'Baixa o episódio mais novo e apaga o anterior.'],
    [3, 'Manter os 3 últimos', 'Mantém no máximo os 3 episódios mais recentes.'],
    [0, 'Manter todos', 'Baixa todos os episódios e guarda todo o histórico.']
  ];
  // Caixa de escolha de retenção: usada para adicionar canal e para mudar a retenção de um canal.
  function retentionDialog(title, current, saveLabel, onSave) {
    var overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-[300] bg-black/60 flex items-center justify-center p-4';
    overlay.innerHTML = '<div class="bg-[#18181f] border border-white/10 rounded-2xl p-5 w-full max-w-md space-y-3">' +
      '<div class="text-base font-bold text-white">' + esc(title) + '</div>' +
      KEEP_OPTIONS.map(function (o) {
        return '<label class="flex items-start gap-3 p-3 rounded-xl bg-black/40 cursor-pointer">' +
          '<input type="radio" name="pod-keep" value="' + o[0] + '" class="mt-1 accent-[#3b8cff]"' + (o[0] === current ? ' checked' : '') + ' />' +
          '<span><span class="block text-sm font-bold text-white">' + o[1] + '</span>' +
          '<span class="block text-xs text-[#a7a7b0]">' + o[2] + '</span></span></label>';
      }).join('') +
      '<div class="flex justify-end gap-2 pt-2">' +
      '<button type="button" data-keep-cancel class="px-4 py-2 rounded-full text-xs font-bold bg-white/10 hover:bg-white/15 text-white">Cancelar</button>' +
      '<button type="button" data-keep-save class="px-4 py-2 rounded-full text-xs font-extrabold bg-[#3b8cff] text-black hover:bg-[#5aa0ff]">' + esc(saveLabel) + '</button></div></div>';
    document.body.appendChild(overlay);
    var close = function () { overlay.remove(); };
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    overlay.querySelector('[data-keep-cancel]').onclick = close;
    overlay.querySelector('[data-keep-save]').onclick = async function () {
      var checked = overlay.querySelector('input[name="pod-keep"]:checked');
      if (!checked) { toast('Escolha uma retenção'); return; }
      try {
        await onSave(Number(checked.value));
        close();
      } catch (e) { toast('Erro: ' + errMsg(e)); }
    };
  }
  // Adicionar canal: a retenção é obrigatória (não há padrão), e só então o canal é gravado.
  function addPodcastWithRetention(title, body) {
    retentionDialog('Retenção para "' + title + '"', null, 'Adicionar', async function (v) {
      await apiJson('/api/seer/podcasts', { method: 'POST', json: Object.assign({}, body, { keepPolicy: v }) });
      toast('Canal adicionado: ' + title);
      loadPodcasts();
    });
  }
  // Mudar retenção: antes de apagar downloads que saem do novo modo, pergunta.
  window.openRetention = function (id) {
    var ch = pod.channels.find(function (c) { return c.id === id; });
    if (!ch) return;
    retentionDialog('Retenção: ' + ch.title, ch.keepPolicy, 'Salvar', async function (v) {
      var plan = await apiJson('/api/seer/podcasts/' + encodeURIComponent(id) + '/prune-preview?keepPolicy=' + v) || [];
      var prune = false;
      if (plan.length) {
        prune = window.confirm(plan.length + ' episódio(s) baixado(s) não entram em "' + keepLabel(v) + '" e serão apagados do disco.\n\n' +
          'OK: apagar agora.\nCancelar: só mudar a retenção e manter os arquivos.');
      }
      await api('/api/seer/podcasts/' + encodeURIComponent(id), { method: 'PUT', json: { keepPolicy: v, autoDownload: v !== -1, prune: prune } });
      toast('Retenção: ' + keepLabel(v) + (prune ? ' · ' + plan.length + ' apagado(s)' : ''));
      loadPodcasts();
    });
  };
  // Remover canal: apaga também os episódios baixados.
  window.removePodcast = async function (id) {
    var ch = pod.channels.find(function (c) { return c.id === id; });
    var n = ch ? (ch.downloadedCount || 0) : 0;
    if (!window.confirm('Remover "' + (ch ? ch.title : 'este canal') + '" e apagar os ' + n + ' episódio(s) baixado(s) do disco?\n\nNão dá para desfazer.')) return;
    try { await api('/api/seer/podcasts/' + encodeURIComponent(id) + '?deleteFiles=true', { method: 'DELETE' }); loadPodcasts(); }
    catch (e) { toast('Erro: ' + errMsg(e)); }
  };
  function keepLabel(n) { return n === -1 ? 'Apenas manual' : n === 1 ? 'Manter apenas o último' : n === 3 ? 'Manter os 3 últimos' : 'Manter todos'; }

  // Episódios: os baixados sempre aparecem primeiro (do mais novo ao mais antigo); os demais ficam
  // atrás do botão "Ver os demais", que os mostra embaixo da lista.
  function podEpisodesHtml(c, eps) {
    if (!eps.length) return '<div class="text-xs text-[#a7a7b0]">Sem episódios.</div>';
    var byDate = function (a, b) { return String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')); };
    var have = eps.filter(function (ep) { return ep.status === 'downloaded'; }).sort(byDate);
    var rest = eps.filter(function (ep) { return ep.status !== 'downloaded'; }).sort(byDate);
    var more = !!pod.more[c.id];
    return have.map(function (ep) { return podEpRow(c, ep); }).join('') +
      (rest.length ? '<button type="button" onclick="podToggleMore(\'' + c.id + '\')" class="w-full py-2 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-bold text-[#3b8cff]">' +
        (more ? 'Ocultar os demais' : 'Ver os demais (' + rest.length + ')') + '</button>' : '') +
      (more ? rest.map(function (ep) { return podEpRow(c, ep); }).join('') : '');
  }
  function podEpRow(c, ep) {
    var ok = ep.status === 'downloaded';
    var when = ep.publishedAt ? new Date(ep.publishedAt).toLocaleDateString(window.seerLocale ? window.seerLocale() : 'pt-BR') : '';
    return '<div class="p-2.5 rounded-xl bg-black/40 flex items-center justify-between gap-2"><div class="min-w-0">' +
      '<div class="text-xs font-bold text-white truncate">' + esc(ep.title) + '</div>' +
      '<div class="text-[11px] text-[#a7a7b0]">' + when + (ep.duration ? ' · ' + fmtDur(ep.duration) : '') + ' · ' + esc(ep.status) + '</div></div>' +
      (ok
        ? '<button type="button" onclick="playEpisode(\'' + c.id + '\',\'' + ep.id + '\')" class="w-8 h-8 rounded-full bg-[#3b8cff] text-black flex items-center justify-center flex-shrink-0"><svg class="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button>'
        : '<button type="button" onclick="downloadEpisode(\'' + c.id + '\',\'' + ep.id + '\')" class="px-2.5 py-1 rounded-full bg-white/10 hover:bg-white/20 text-[11px] font-bold text-white flex-shrink-0">Baixar</button>') +
      '</div>';
  }
  window.podToggleMore = function (id) { pod.more[id] = !pod.more[id]; renderCurrentView(); };

  window.renderPodcastsView = function () {
    if (!pod.loading && !pod.channels.length && !pod.error && !pod._tried) { pod._tried = true; loadPodcasts(); }
    var cards = pod.channels.map(function (c) {
      var eps = pod.open === c.id ? (pod.episodes[c.id] || null) : null;
      var epHtml = '';
      if (pod.open === c.id) {
        epHtml = eps === null ? '<div class="text-xs text-[#a7a7b0] pulse-green">Carregando episódios…</div>' : podEpisodesHtml(c, eps);
      }
      return '<div class="bg-[#18181f] border border-white/[0.06] rounded-2xl p-5 flex flex-col justify-between">' +
        '<div><div class="flex items-center gap-3.5 mb-3 cursor-pointer" onclick="togglePodcast(\'' + c.id + '\')">' +
        (c.imageUrl ? '<img src="' + esc(c.imageUrl) + '" alt="" loading="lazy" class="w-16 h-16 rounded-xl object-cover shadow-lg bg-white/5" />'
          : '<div class="w-16 h-16 rounded-xl bg-white/10 flex items-center justify-center text-2xl">🎙</div>') +
        '<div class="min-w-0 flex-1"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/20 text-purple-300">' + keepLabel(c.keepPolicy) + '</span>' +
        '<h3 class="font-bold text-base text-white mt-1 leading-snug">' + esc(c.title) + '</h3>' +
        '<div class="text-xs text-[#a7a7b0]">' + esc(c.author || '') + ' · ' + (c.downloadedCount || 0) + '/' + (c.episodeCount || 0) + ' baixados</div></div></div>' +
        '<div class="space-y-2 pt-1 max-h-[420px] overflow-y-auto pr-1">' + epHtml + '</div></div>' +
        '<div class="flex items-center justify-between mt-4 pt-3 border-t border-white/[0.05] text-[11px] text-[#a7a7b0]">' +
        '<span>' + (c.lastError ? '<span class="text-red-300">' + esc(c.lastError) + '</span>' : (c.lastCheckedAt ? 'Checado: ' + new Date(c.lastCheckedAt).toLocaleString(window.seerLocale ? window.seerLocale() : 'pt-BR') : 'Ainda não checado')) + '</span>' +
        '<span class="flex gap-3"><button type="button" onclick="openRetention(\'' + c.id + '\')" class="text-[#3b8cff] font-bold hover:underline">Retenção</button>' +
        '<button type="button" onclick="removePodcast(\'' + c.id + '\')" class="text-red-300 font-bold hover:underline">Remover</button></span></div></div>';
    }).join('');
    return '<div class="view-animate space-y-6 pb-8"><div class="flex flex-wrap items-center justify-between gap-4"><div>' +
      '<h1 class="font-display font-black text-3xl text-white tracking-tight">Podcasts & Canais (YouTube + RSS)</h1>' +
      '<p class="text-xs text-[#a7a7b0] mt-1">Verificação periódica com política de retenção por canal</p></div>' +
      '<div class="flex gap-2"><button type="button" onclick="syncAllPodcasts()" class="px-4 py-2 rounded-full text-xs font-bold bg-white/10 hover:bg-white/15 text-white transition">↻ Verificar Todos Agora</button>' +
      '<button type="button" onclick="addDemoPodcast()" class="px-4 py-2 rounded-full text-xs font-extrabold bg-[#3b8cff] text-black hover:bg-[#5aa0ff] transition">+ Adicionar Canal YouTube / RSS</button></div></div>' +
      (pod.q ? podSearchHtml() : '') +
      (pod.error ? '<div class="text-sm text-red-300">' + esc(pod.error) + '</div>' : '') +
      (pod.loading ? '<div class="text-sm text-[#a7a7b0] pulse-green">Carregando…</div>' : '') +
      '<div class="grid grid-cols-1 lg:grid-cols-3 gap-4">' + cards + '</div>' +
      (!pod.channels.length && !pod.loading && !pod.error ? '<div class="text-sm text-[#a7a7b0]">Nenhum canal ainda. Adicione um feed RSS ou canal do YouTube.</div>' : '') +
      '</div>';
  };

  // rádios da web + links compartilhados
  // Busca no diretório público radio-browser.info; adicionar grava no Guitarr (/api/radio, só admin).
  var radio = { stations: [], shares: [], loaded: false, error: '', q: '', found: [], searching: false,
    searchErr: '', formOpen: false, timer: null };
  var RADIO_DIR = 'https://de1.api.radio-browser.info/json/stations/search';

  async function loadRadios() {
    radio.error = '';
    try {
      var r = await Promise.all([
        apiJson('/api/radio?_start=0&_end=200&_sort=name&_order=ASC').catch(function () { return []; }),
        apiJson('/api/share?_start=0&_end=200&_sort=createdAt&_order=DESC').catch(function () { return []; })
      ]);
      radio.stations = r[0] || []; radio.shares = r[1] || [];
    } catch (e) { radio.error = errMsg(e); }
    radio.loaded = true;
    if (state.currentView === 'radios') renderCurrentView();
  }

  async function radioSearch() {
    var q = state.searchQuery.trim();
    radio.q = q;
    if (!q) { radio.found = []; radio.searching = false; radio.searchErr = ''; renderCurrentView(); return; }
    radio.searching = true; radio.searchErr = ''; renderCurrentView();
    try {
      var r = await fetch(RADIO_DIR + '?name=' + encodeURIComponent(q) +
        '&limit=40&hidebroken=true&order=votes&reverse=true');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var arr = await r.json();
      if (radio.q !== q) return;
      var out = [];
      (arr || []).forEach(function (x) {
        var u = x.url_resolved || x.url || '';
        if (!/^https?:\/\//i.test(u) || x.hls || /\.m3u8(\?|$)/i.test(u)) return; // HLS não toca em <audio>
        out.push({ name: String(x.name || '').trim() || u, url: u, home: x.homepage || '',
          country: x.countrycode || '', codec: x.codec || '', bitrate: x.bitrate || 0, https: /^https:/i.test(u) });
      });
      // https primeiro (a página é https: stream http é bloqueado pelo navegador)
      radio.found = out.filter(function (s) { return s.https; }).concat(out.filter(function (s) { return !s.https; })).slice(0, 25);
    } catch (e) {
      if (radio.q !== q) return;
      radio.found = [];
      radio.searchErr = 'Não consegui consultar o diretório de rádios (' + errMsg(e) + ').';
    }
    radio.searching = false;
    renderCurrentView();
  }

  function playStream(name, url, sub) {
    ext = { title: esc(name), subtitle: sub || 'Rádio ao vivo', cover: '', live: true };
    loadedKey = 'radio:' + url;
    audio.src = url;
    state.isPlaying = true;
    updateMediaSession(ext.title, ext.subtitle, '', '');
    updatePlayerUI(); syncAudio();
    toast('Sintonizando: ' + unesc(ext.title));
  }
  window.playRadio = function (id) {
    var st = radio.stations.find(function (s) { return s.id === id; });
    if (st) playStream(st.name, st.streamUrl);
  };
  window.playFoundRadio = function (i) {
    var s = radio.found[i];
    if (!s) return;
    if (!s.https && location.protocol === 'https:') toast('Este stream é http e o navegador pode bloqueá-lo nesta página');
    playStream(s.name, s.url);
  };

  async function createRadio(name, url, home) {
    if (!auth.isAdmin) { toast('Só administradores podem cadastrar rádios no Guitarr'); return false; }
    try {
      await api('/api/radio', { method: 'POST', json: { name: name, streamUrl: url, homePageUrl: home || '' } });
      toast('Rádio "' + name + '" adicionada');
      await loadRadios();
      return true;
    } catch (e) { toast('Erro ao adicionar: ' + errMsg(e)); return false; }
  }
  window.addFoundRadio = async function (i) {
    var s = radio.found[i];
    if (s && await createRadio(s.name, s.url, s.home)) renderCurrentView();
  };
  window.toggleRadioForm = function () { radio.formOpen = !radio.formOpen; renderCurrentView(); };
  window.addRadioManual = async function () {
    var name = ($('radio-in-name') || {}).value || '', url = ($('radio-in-url') || {}).value || '',
      home = ($('radio-in-home') || {}).value || '';
    name = name.trim(); url = url.trim(); home = home.trim();
    if (!name || !/^https?:\/\//i.test(url)) { toast('Informe o nome e o endereço do stream (http:// ou https://)'); return; }
    if (await createRadio(name, url, home)) { radio.formOpen = false; renderCurrentView(); }
  };
  window.removeRadio = async function (id) {
    var st = radio.stations.find(function (s) { return s.id === id; });
    if (!window.confirm('Remover a rádio "' + (st ? st.name : '') + '"?')) return;
    try { await api('/api/radio/' + encodeURIComponent(id), { method: 'DELETE' }); toast('Rádio removida'); loadRadios(); }
    catch (e) { toast('Erro ao remover: ' + errMsg(e)); }
  };

  window.copyShare = function (id) {
    var url = location.origin + '/share/' + id;
    try {
      if (navigator.clipboard) navigator.clipboard.writeText(url);
      else { var ta = document.createElement('textarea'); ta.value = url; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); }
    } catch (e) {}
    toast('Link copiado: ' + url);
  };

  window.renderRadiosView = function () {
    if (!radio.loaded) { radio.loaded = true; loadRadios(); }
    var q = state.searchQuery.trim();
    if (radio.q !== q && !radio.searching) setTimeout(radioSearch, 0);
    var have = {};
    radio.stations.forEach(function (s) { have[s.streamUrl] = true; });
    var admin = !!(auth && auth.isAdmin);
    var inputCls = 'w-full px-3.5 py-2.5 rounded-xl bg-black/50 border border-white/15 text-sm text-white focus:border-[#3b8cff] focus:outline-none';

    var form = (admin && radio.formOpen)
      ? '<div class="bg-[#18181f] border border-white/[0.06] rounded-2xl p-5 grid grid-cols-1 md:grid-cols-3 gap-3">' +
        '<input id="radio-in-name" placeholder="Nome da rádio" class="' + inputCls + '" />' +
        '<input id="radio-in-url" placeholder="Endereço do stream (https://…)" class="' + inputCls + '" />' +
        '<input id="radio-in-home" placeholder="Site (opcional)" class="' + inputCls + '" />' +
        '<div class="md:col-span-3 flex gap-2"><button type="button" onclick="addRadioManual()" class="px-4 py-2 rounded-full text-xs font-extrabold bg-[#3b8cff] text-black hover:bg-[#5aa0ff] transition">Salvar rádio</button>' +
        '<button type="button" onclick="toggleRadioForm()" class="px-4 py-2 rounded-full text-xs font-bold bg-white/10 hover:bg-white/15 text-white transition">Cancelar</button></div></div>'
      : '';

    var found = '';
    if (q) {
      var rows;
      if (radio.searching) rows = '<div class="py-8 text-center text-sm text-[#a7a7b0] pulse-green">Buscando rádios…</div>';
      else if (radio.searchErr) rows = '<div class="py-8 text-center text-sm text-red-300">' + esc(radio.searchErr) + '</div>';
      else if (!radio.found.length) rows = '<div class="py-8 text-center text-sm text-[#a7a7b0]">Nenhuma rádio encontrada para "' + esc(q) + '". Você pode adicionar pelo endereço do stream.</div>';
      else rows = radio.found.map(function (s, i) {
        var meta = [s.country, s.codec, s.bitrate ? s.bitrate + ' kbps' : ''].filter(Boolean).join(' · ');
        var add = have[s.url]
          ? '<span class="px-3 py-1.5 rounded-full text-xs font-bold bg-white/10 text-[#3b8cff]">✓ Adicionada</span>'
          : (admin ? '<button type="button" onclick="addFoundRadio(' + i + ')" class="px-3.5 py-1.5 rounded-full text-xs font-extrabold bg-[#3b8cff] hover:bg-[#5aa0ff] text-black transition">+ Adicionar</button>' : '');
        return '<div class="flex items-center justify-between gap-3 p-2.5 rounded-xl hover:bg-white/[0.06] transition">' +
          '<div class="min-w-0"><div class="text-sm font-bold text-white truncate">' + esc(s.name) +
          (s.https ? '' : ' <span class="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-semibold align-middle" title="Stream http: pode ser bloqueado nesta página https">http</span>') + '</div>' +
          '<div class="text-xs text-[#a7a7b0] truncate">' + esc(meta) + '</div></div>' +
          '<div class="flex items-center gap-2 flex-shrink-0">' +
          '<button type="button" onclick="playFoundRadio(' + i + ')" title="Ouvir" class="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center"><svg class="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button>' +
          add + '</div></div>';
      }).join('');
      found = '<div><h2 class="font-display font-bold text-base text-white mb-2.5">Resultados do diretório de rádios</h2>' +
        '<div class="bg-[#18181f] rounded-2xl p-3 border border-white/[0.05] space-y-1.5">' + rows + '</div></div>';
    } else {
      found = '<div class="text-sm text-[#a7a7b0]">Digite o nome de uma rádio na busca acima (ex.: <span class="text-white font-semibold">Dumont FM</span>) para encontrá-la e adicionar.</div>';
    }

    var st = radio.stations.map(function (s) {
      return '<div class="gt-card p-5 rounded-2xl flex items-center justify-between gap-3"><div class="min-w-0">' +
        '<span class="text-[10px] font-bold uppercase text-[#3b8cff]">Ao Vivo</span>' +
        '<h3 class="font-bold text-lg text-white mt-0.5 leading-snug line-clamp-2 break-words">' + esc(s.name) + '</h3>' +
        '<p class="text-xs text-[#a7a7b0] truncate">' + esc(s.homePageUrl || s.streamUrl) + '</p></div>' +
        '<div class="flex items-center gap-2 flex-shrink-0">' +
        (admin ? '<button type="button" onclick="removeRadio(\'' + s.id + '\')" title="Remover" class="w-9 h-9 rounded-full bg-white/10 hover:bg-red-500/30 text-red-300 flex items-center justify-center text-lg leading-none">×</button>' : '') +
        '<button type="button" onclick="playRadio(\'' + s.id + '\')" class="w-11 h-11 rounded-full bg-[#3b8cff] text-black flex items-center justify-center shadow-lg">' +
        '<svg class="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button></div></div>';
    }).join('');
    var sh = radio.shares.map(function (s) {
      return '<div class="gt-card p-5 rounded-2xl flex items-center justify-between gap-3"><div class="min-w-0">' +
        '<span class="text-[10px] font-bold uppercase text-purple-400">Link compartilhado</span>' +
        '<h3 class="font-bold text-lg text-white mt-0.5 truncate">' + esc(s.description || s.resourceType || 'Compartilhamento') + '</h3>' +
        '<p class="text-xs text-[#a7a7b0] truncate">' + esc(location.host + '/share/' + s.id) + '</p></div>' +
        '<button type="button" onclick="copyShare(\'' + s.id + '\')" class="px-3.5 py-2 rounded-full bg-white/10 hover:bg-white/20 text-xs font-bold text-white flex-shrink-0">Copiar Link</button></div>';
    }).join('');

    return '<div class="space-y-6 pb-8"><div class="flex flex-wrap items-center justify-between gap-4"><div>' +
      '<h1 class="font-display font-black text-3xl text-white tracking-tight">Rádios Web & Links Compartilhados</h1>' +
      '<p class="text-xs text-[#a7a7b0] mt-1">Estações cadastradas no Guitarr e links públicos criados por você</p></div>' +
      (admin ? '<button type="button" onclick="toggleRadioForm()" class="px-4 py-2 rounded-full text-xs font-extrabold bg-[#3b8cff] text-black hover:bg-[#5aa0ff] transition">+ Adicionar rádio pelo endereço</button>' : '') +
      '</div>' + form + found +
      (radio.error ? '<div class="text-sm text-red-300">' + esc(radio.error) + '</div>' : '') +
      '<div><h2 class="font-display font-bold text-base text-white mb-2.5">Suas rádios e links</h2>' +
      '<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">' + st + sh + '</div>' +
      (!radio.stations.length && !radio.shares.length && radio.loaded ? '<div class="text-sm text-[#a7a7b0]">Nenhuma rádio ou link compartilhado cadastrado.</div>' : '') +
      '</div></div>';
  };

  // ----------------------------------------------- organizar metadados (admin) ---
  // Mostra álbuns/artistas repetidos por grafia, álbuns sem código MusicBrainz e faixas sem tags;
  // corrige reescrevendo as tags dos arquivos (rotas /api/seer/library/*) com os dados do MusicBrainz.
  var meta = { report: null, loading: false, error: '', busy: '', pick: {}, sugg: {}, suggBusy: {}, msg: '', cover: {},
    ignore: { noMbid: [], noCover: [] }, showIgnored: false };

  function nk(s) { // chave "frouxa": sem acento, caixa ou pontuação
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');
  }
  async function loadMetaReport() {
    if (!auth || !auth.isAdmin) return;
    meta.loading = true; meta.error = '';
    if (state.currentView === 'meta') renderCurrentView();
    try {
      meta.report = await apiJson('/api/seer/library/metadata-report');
      meta.pick = {}; // os índices dos grupos mudam a cada análise
      meta.missing = await loadMissing();
      try {
        var st = await apiJson('/api/seer/state'), mi = st && st.metaIgnore;
        meta.ignore = { noMbid: (mi && mi.noMbid) || [], noCover: (mi && mi.noCover) || [] };
      } catch (e3) {}
      var n = (meta.report.albumGroups || []).length + (meta.report.artistGroups || []).length;
      setText('nav-meta-badge', n ? String(n) : 'ok');
    } catch (e) { meta.error = errMsg(e); }
    meta.loading = false;
    if (state.currentView === 'meta') renderCurrentView();
  }
  // Registros de arquivos que sumiram do disco (missing=true). A API nativa já tem o DELETE (só admin).
  async function loadMissing() {
    try {
      var res = await api('/api/missing?_start=0&_end=8&_sort=path&_order=ASC');
      var items = await res.json();
      var total = parseInt(res.headers.get('x-total-count') || '', 10);
      return { total: isNaN(total) ? items.length : total, items: items };
    } catch (e) { return { total: 0, items: [] }; }
  }
  window.metaPurgeMissing = async function () {
    var n = meta.missing ? meta.missing.total : 0;
    if (!n || meta.busy) return;
    if (!window.confirm('Apagar ' + n + ' registro(s) de arquivos que não existem mais no disco?\n\nIsto só remove as linhas do banco; nenhum arquivo é tocado. Se algum HD/pasta estiver desmontado, monte antes e analise de novo.')) return;
    setMetaBusy('Apagando registros…');
    try {
      await api('/api/missing', { method: 'DELETE' });
      toast(n + ' registro(s) removido(s)');
      meta.busy = '';
      await metaRefreshAll();
    } catch (e) { meta.busy = ''; toast('Erro ao apagar: ' + errMsg(e)); renderCurrentView(); }
  };
  async function metaRefreshAll() {
    try { await loadLibrary(); refreshChrome(); } catch (e) {}
    await loadMetaReport();
  }
  function editAlbum(id, changes) {
    return api('/api/seer/library/album/' + encodeURIComponent(id), { method: 'PUT', json: changes });
  }
  function editSong(id, changes) {
    return api('/api/seer/library/song/' + encodeURIComponent(id), { method: 'PUT', json: changes });
  }
  function setMetaBusy(msg) { meta.busy = msg; meta.msg = msg; if (state.currentView === 'meta') renderCurrentView(); }

  window.metaAnalyze = function () { loadMetaReport(); };
  window.metaPick = function (key, idx) { meta.pick[key] = idx; renderCurrentView(); };
  // índice escolhido dentro do grupo, sempre dentro do intervalo
  function pickOf(key, n) { var i = meta.pick[key] || 0; return i >= 0 && i < n ? i : 0; }

  window.metaMergeAlbums = async function (gi) {
    var g = meta.report.albumGroups[gi]; if (!g || meta.busy) return;
    var ci = pickOf('a' + gi, g.variants.length), canon = g.variants[ci];
    // ids: do escolhido; se ele não tem, empresta de outra variante
    var withId = function (f) { var v = g.variants.find(function (x) { return x[f]; }); return v ? v[f] : ''; };
    var ch = { album: canon.name, albumArtist: canon.artist };
    var a = canon.mbzAlbumId || withId('mbzAlbumId'), r = canon.mbzReleaseGroupId || withId('mbzReleaseGroupId'),
      ar = canon.mbzAlbumArtistId || withId('mbzAlbumArtistId');
    if (a) ch.mbzAlbumId = a; if (r) ch.mbzReleaseGroupId = r; if (ar) ch.mbzAlbumArtistId = ar;
    var todo = g.variants.filter(function (v, i) { return i !== ci; });
    // o próprio escolhido também recebe os ids, para todas as faixas ficarem iguais
    todo.push(canon);
    try {
      for (var i = 0; i < todo.length; i++) {
        setMetaBusy('Mesclando ' + (i + 1) + ' de ' + todo.length + '…');
        await editAlbum(todo[i].id, ch);
      }
      toast('Álbuns mesclados em "' + canon.name + '"');
    } catch (e) { toast('Erro ao mesclar: ' + errMsg(e)); }
    meta.busy = ''; await metaRefreshAll();
  };

  window.metaMergeArtists = async function (gi) {
    var g = meta.report.artistGroups[gi]; if (!g || meta.busy) return;
    var ci = pickOf('r' + gi, g.variants.length), canon = g.variants[ci].name;
    var jobs = [];
    g.variants.forEach(function (v, i) {
      if (i === ci) return;
      // o servidor manda null (não []) quando a grafia só existe como artista do álbum, ou só nas faixas
      (v.albums || []).forEach(function (id) { jobs.push(['album', id]); });
      (v.songIds || []).forEach(function (id) { jobs.push(['song', id]); });
    });
    try {
      for (var i = 0; i < jobs.length; i++) {
        setMetaBusy('Unificando artista ' + (i + 1) + ' de ' + jobs.length + '…');
        if (jobs[i][0] === 'album') await editAlbum(jobs[i][1], { albumArtist: canon });
        else await editSong(jobs[i][1], { artist: canon });
      }
      toast('Artista unificado como "' + canon + '"');
    } catch (e) { toast('Erro ao unificar: ' + errMsg(e)); }
    meta.busy = ''; await metaRefreshAll();
  };

  async function suggestFor(v) {
    meta.suggBusy[v.id] = true;
    try {
      var res = await apiJson('/api/seer/catalog?q=' + encodeURIComponent(v.artist + ' ' + v.name) + '&limit=10');
      var items = (res || []).filter(function (x) { return x.kind === 'album'; });
      var ka = nk(v.name), kr = nk(v.artist);
      items.forEach(function (x) {
        x._score = (nk(x.title) === ka ? 2 : (nk(x.title).indexOf(ka) >= 0 || ka.indexOf(nk(x.title)) >= 0 ? 1 : 0)) +
          (nk(x.artist) === kr ? 2 : 0);
      });
      items.sort(function (a, b) { return b._score - a._score; });
      meta.sugg[v.id] = items.slice(0, 3);
    } catch (e) { meta.sugg[v.id] = []; toast('Sem resposta do MusicBrainz: ' + errMsg(e)); }
    delete meta.suggBusy[v.id];
    if (state.currentView === 'meta') renderCurrentView();
  }
  // "Ignorar": álbuns que o admin decidiu deixar assim (sem código no MusicBrainz, sem capa). Ficam
  // guardados por usuário no servidor (/api/seer/state, chave metaIgnore) e saem das listas e dos botões "todos".
  function isIgnored(kind, id) { return (meta.ignore[kind] || []).indexOf(id) >= 0; }
  function activeList(kind) { return ((meta.report && meta.report[kind]) || []).filter(function (v) { return !isIgnored(kind, v.id); }); }
  function ignoredList(kind) { return ((meta.report && meta.report[kind]) || []).filter(function (v) { return isIgnored(kind, v.id); }); }
  async function saveIgnore() {
    try { await api('/api/seer/state', { method: 'PUT', json: { metaIgnore: meta.ignore } }); }
    catch (e) { toast('Não consegui guardar a lista de ignorados: ' + errMsg(e)); }
  }
  window.metaIgnore = function (kind, id) {
    if (!isIgnored(kind, id)) meta.ignore[kind] = (meta.ignore[kind] || []).concat([id]);
    renderCurrentView(); saveIgnore();
  };
  window.metaUnignore = function (kind, id) {
    meta.ignore[kind] = (meta.ignore[kind] || []).filter(function (x) { return x !== id; });
    renderCurrentView(); saveIgnore();
  };
  window.metaToggleIgnored = function () { meta.showIgnored = !meta.showIgnored; renderCurrentView(); };

  window.metaSuggest = function (i) { var v = activeList('noMbid')[i]; if (v) suggestFor(v); };
  window.metaSuggestAll = async function () {
    if (meta.busy) return;
    var list = activeList('noMbid').slice(0, 40);
    try {
      for (var i = 0; i < list.length; i++) {
        if (meta.sugg[list[i].id]) continue;
        setMetaBusy('Procurando no MusicBrainz ' + (i + 1) + ' de ' + list.length + '…');
        await suggestFor(list[i]);
      }
    } catch (e) { toast('Erro ao sugerir: ' + errMsg(e)); }
    meta.busy = ''; renderCurrentView();
  };

  async function applyMatch(albumId, item) {
    var d = await apiJson('/api/seer/catalog/album/' + encodeURIComponent(item.mbid));
    var al = d.album || item;
    var ch = { album: al.title, albumArtist: al.artist, mbzReleaseGroupId: item.mbid };
    if (al.year) ch.year = String(al.year);
    if (al.releaseId) ch.mbzAlbumId = al.releaseId;
    if (al.artistMbid) ch.mbzAlbumArtistId = al.artistMbid;
    var res = await editAlbum(albumId, ch), newId = albumId;
    try { var j = await res.json(); if (j && j.albumId) newId = j.albumId; } catch (e) {}
    try { await fetchCoverFor(newId, false); } catch (e) {} // sem capa? já aproveita e procura
  }
  window.metaApply = async function (i, si) {
    if (meta.busy) return;
    var v = activeList('noMbid')[i], it = v && (meta.sugg[v.id] || [])[si];
    if (!it) return;
    try { setMetaBusy('Aplicando "' + it.title + '"…'); await applyMatch(v.id, it); toast('Atualizado: "' + it.title + '"'); }
    catch (e) { toast('Erro ao aplicar: ' + errMsg(e)); }
    meta.busy = ''; await metaRefreshAll();
  };
  window.metaApplyExact = async function () {
    var exact = activeList('noMbid').filter(function (v) {
      var s = (meta.sugg[v.id] || [])[0];
      return s && nk(s.title) === nk(v.name) && nk(s.artist) === nk(v.artist);
    });
    if (!exact.length) { toast('Nenhuma sugestão exata ainda. Use "Sugerir para todos" primeiro.'); return; }
    if (!window.confirm('Aplicar ' + exact.length + ' sugestões exatas (mesmo nome e artista)? As tags dos arquivos serão reescritas.')) return;
    var ok = 0;
    for (var i = 0; i < exact.length; i++) {
      setMetaBusy('Aplicando ' + (i + 1) + ' de ' + exact.length + '…');
      try { await applyMatch(exact[i].id, meta.sugg[exact[i].id][0]); ok++; } catch (e) {}
    }
    toast(ok + ' de ' + exact.length + ' álbuns atualizados');
    meta.busy = ''; await metaRefreshAll();
  };

  // Capas: procura online (Cover Art Archive, iTunes, Deezer) e salva cover.jpg na pasta do álbum.
  function fetchCoverFor(id, force) {
    return apiJson('/api/seer/library/album/' + encodeURIComponent(id) + '/cover' + (force ? '?force=1' : ''), { method: 'POST' });
  }
  window.metaFetchCover = async function (i) {
    if (meta.busy) return;
    var v = activeList('noCover')[i]; if (!v || meta.cover[v.id] === 'busy') return;
    meta.cover[v.id] = 'busy'; renderCurrentView();
    try {
      var r = await fetchCoverFor(v.id, false);
      if (r && r.refreshed) { delete meta.cover[v.id]; coverBust[v.id] = Date.now(); toast('Capa corrigida: "' + v.name + '"'); setTimeout(metaRefreshAll, 3000); return; }
      if (r && r.found) { delete meta.cover[v.id]; coverBust[v.id] = Date.now(); toast('Capa encontrada (' + r.source + '): "' + v.name + '"'); await metaRefreshAll(); return; }
      meta.cover[v.id] = 'none';
    } catch (e) { delete meta.cover[v.id]; toast('Erro ao buscar capa: ' + errMsg(e)); }
    renderCurrentView();
  };
  window.metaUploadCover = async function (i, input) {
    var v = activeList('noCover')[i], f = input.files && input.files[0]; input.value = '';
    if (!v || !f || meta.busy || meta.cover[v.id] === 'busy') return;
    meta.cover[v.id] = 'busy'; renderCurrentView();
    try {
      await uploadCover(v.id, f);
      delete meta.cover[v.id]; toast('Capa salva: "' + v.name + '"'); await metaRefreshAll(); return;
    } catch (e) { delete meta.cover[v.id]; toast('Erro ao enviar capa: ' + errMsg(e)); }
    renderCurrentView();
  };
  window.metaFetchAllCovers = async function () {
    if (meta.busy) return;
    var list = activeList('noCover').filter(function (v) { return meta.cover[v.id] !== 'none'; });
    if (!list.length) { toast('Nenhum álbum novo para procurar.'); return; }
    var found = 0, none = 0;
    for (var i = 0; i < list.length; i++) {
      setMetaBusy('Procurando capas ' + (i + 1) + ' de ' + list.length + '…');
      try {
        var r = await fetchCoverFor(list[i].id, false);
        if (r && (r.found || r.refreshed)) { found++; coverBust[list[i].id] = Date.now(); } else { none++; meta.cover[list[i].id] = 'none'; }
      } catch (e) { none++; }
    }
    toast(found + ' capas salvas' + (none ? ', ' + none + ' sem resultado' : ''));
    meta.busy = ''; await metaRefreshAll();
  };

  // Arquivos sem tag baixados antes do retag ficam em Artista/Álbum/arquivo: a pasta diz o que falta.
  function guessFromPath(u) {
    var parts = String(u.path || '').split('/');
    if (parts.length < 3) return null;
    var album = parts[parts.length - 2], artist = parts[parts.length - 3];
    if (!artist || !album || /^podcasts$/i.test(artist)) return null;
    var ch = {}, unk = function (s) { return /^\[unknown/i.test(String(s || '').trim()); };
    if (unk(u.artist)) { ch.artist = artist; ch.albumArtist = artist; }
    if (unk(u.album)) ch.album = album;
    return Object.keys(ch).length ? ch : null;
  }
  async function fillOne(u) {
    var ch = guessFromPath(u);
    if (!ch) return false;
    await editSong(u.id, ch);
    return true;
  }
  window.metaFillPath = async function (i) {
    if (meta.busy) return;
    var u = meta.report.unknown[i]; if (!u) return;
    try { setMetaBusy('Preenchendo pela pasta…'); if (await fillOne(u)) toast('Tags preenchidas a partir da pasta'); }
    catch (e) { toast('Erro ao preencher: ' + errMsg(e)); }
    meta.busy = ''; await metaRefreshAll();
  };
  window.metaFillAll = async function () {
    if (meta.busy) return;
    var list = meta.report.unknown.filter(function (u) { return guessFromPath(u); });
    if (!list.length) { toast('Nenhuma faixa com pasta útil'); return; }
    if (!window.confirm('Preencher artista/álbum de ' + list.length + ' faixas a partir do nome da pasta? As tags dos arquivos serão reescritas.')) return;
    var ok = 0;
    for (var i = 0; i < list.length; i++) {
      setMetaBusy('Preenchendo ' + (i + 1) + ' de ' + list.length + '…');
      try { if (await fillOne(list[i])) ok++; } catch (e) {}
    }
    toast(ok + ' de ' + list.length + ' faixas preenchidas. Rode "Sugerir para todos" para ligar ao MusicBrainz.');
    meta.busy = ''; await metaRefreshAll();
  };

  function variantRow(v, name, checked, pickCall) {
    return '<label class="flex items-center gap-3 p-2 rounded-lg hover:bg-white/[0.05] cursor-pointer">' +
      '<input type="radio" name="' + name + '" ' + (checked ? 'checked' : '') + ' onchange="' + pickCall + '" class="accent-[#3b8cff]" />' + v + '</label>';
  }
  window.renderMetaView = function () {
    try { return renderMetaViewInner(); }
    catch (e) {
      if (window.console) console.error(e);
      return '<div class="py-12 text-center text-sm text-red-300">Não consegui desenhar esta tela (' + esc(errMsg(e)) + '). ' +
        '<button type="button" onclick="metaAnalyze()" class="underline text-[#3b8cff]">Analisar de novo</button></div>';
    }
  };
  // Lista recolhível dos álbuns ignorados, cada um com "Restaurar".
  function ignoredBlock(kind, list) {
    if (!list.length) return '';
    var open = meta.showIgnored;
    return '<div class="mt-3"><button type="button" onclick="metaToggleIgnored()" class="text-xs font-bold text-[#a7a7b0] hover:text-white">' +
      (open ? '▾' : '▸') + ' Ignorados (' + list.length + ')</button>' +
      (open ? '<div class="mt-2 bg-[#18181f] rounded-2xl border border-white/[0.05] divide-y divide-white/[0.05]">' + list.map(function (v) {
        return '<div class="flex items-center gap-3 p-2.5"><div class="min-w-0 flex-1"><div class="text-sm font-bold text-white truncate">' + esc(v.name) + '</div>' +
          '<div class="text-[11px] text-[#a7a7b0] truncate">' + esc(v.artist) + ' · ' + v.songs + ' faixas</div></div>' +
          '<button type="button" onclick="metaUnignore(\'' + kind + '\',\'' + esc(v.id) + '\')" class="px-3 py-1 rounded-full text-[11px] font-bold bg-white/10 hover:bg-white/20 text-white flex-shrink-0">Restaurar</button></div>';
      }).join('') + '</div>' : '') + '</div>';
  }
  function renderMetaViewInner() {
    if (!auth || !auth.isAdmin) return '<div class="py-12 text-center text-sm text-[#a7a7b0]">Somente administradores podem organizar os metadados.</div>';
    var r = meta.report;
    var pct = r && r.songs ? Math.round(100 * r.songsWithAlbumMbid / r.songs) : 0;
    var busy = meta.busy ? '<div class="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-[#3b8cff] text-black text-xs font-extrabold shadow-xl pulse-green">' + esc(meta.busy) + '</div>' : '';
    var head = '<div class="space-y-6 pb-10">' +
      '<div class="flex flex-wrap items-end justify-between gap-4"><div>' +
      '<h1 class="font-display font-black text-3xl text-white tracking-tight">Organizar Metadados</h1>' +
      '<p class="text-xs text-[#a7a7b0] mt-1 max-w-2xl">Encontra álbuns e artistas repetidos por causa de maiúscula, acento ou hífen, e liga a biblioteca ao MusicBrainz (o "TMDB" da música). Ao aplicar, as tags dos arquivos são reescritas.</p></div>' +
      '<button type="button" onclick="metaAnalyze()" class="px-4 py-2 rounded-full text-xs font-extrabold bg-[#3b8cff] text-black hover:bg-[#5aa0ff] transition">' + (r ? '↻ Analisar de novo' : 'Analisar biblioteca') + '</button></div>' + lyricsBatchCard();
    if (meta.loading) return head + '<div class="py-10 text-center text-sm text-[#a7a7b0] pulse-green">Analisando a biblioteca…</div></div>' + busy;
    if (meta.error) return head + '<div class="text-sm text-red-300">' + esc(meta.error) + '</div></div>' + busy;
    if (!r) return head + '<div class="py-10 text-center text-sm text-[#a7a7b0]">Clique em "Analisar biblioteca" para começar. Nada é alterado nesta etapa.</div></div>' + busy;

    var stat = function (n, label) {
      return '<div class="bg-[#18181f] border border-white/[0.06] rounded-2xl p-4"><div class="text-2xl font-black text-white">' + n + '</div><div class="text-[11px] text-[#a7a7b0]">' + label + '</div></div>';
    };
    var out = head + '<div class="grid grid-cols-2 md:grid-cols-4 gap-3">' +
      stat(pct + '%', 'faixas com código MusicBrainz') + stat(r.albumGroups.length, 'álbuns repetidos') +
      stat(r.artistGroups.length, 'artistas com grafias diferentes') + stat(r.unknown.length, 'faixas sem tags') + '</div>';

    // álbuns repetidos
    out += '<div><h2 class="font-display font-bold text-lg text-white mb-2.5">Álbuns repetidos (' + r.albumGroups.length + ')</h2>';
    if (!r.albumGroups.length) out += '<div class="text-sm text-[#3b8cff]">✓ Nenhum álbum repetido por grafia.</div>';
    r.albumGroups.forEach(function (g, gi) {
      var ci = pickOf('a' + gi, g.variants.length);
      out += '<div class="bg-[#18181f] border border-white/[0.06] rounded-2xl p-3 mb-3">' +
        (g.sameReleaseGroup ? '<div class="text-[11px] text-amber-300 px-2 pb-1">Edições diferentes do mesmo disco no MusicBrainz. Ao mesclar, faixas iguais podem ficar duplicadas (use Espaço &amp; Duplicatas depois).</div>' : '') +
        g.variants.map(function (v, vi) {
          var row = '<img src="' + coverUrl(v.id, 80) + '" alt="" class="w-11 h-11 rounded object-cover bg-white/5 flex-shrink-0" />' +
            '<div class="min-w-0 flex-1"><div class="text-sm font-bold text-white truncate">' + esc(v.name) + '</div>' +
            '<div class="text-xs text-[#a7a7b0] truncate">' + esc(v.artist) + ' · ' + v.songs + ' faixas' + (v.year ? ' · ' + v.year : '') + '</div></div>' +
            '<span class="text-[10px] font-bold px-2 py-0.5 rounded ' + (v.mbzAlbumId ? 'bg-[#3b8cff]/20 text-[#3b8cff]' : 'bg-white/10 text-[#a7a7b0]') + '">' + (v.mbzAlbumId ? 'com código' : 'sem código') + '</span>';
          return variantRow(row, 'ag' + gi, vi === ci, 'metaPick(\'a' + gi + '\',' + vi + ')');
        }).join('') +
        '<div class="flex items-center justify-between px-2 pt-2"><span class="text-[11px] text-[#a7a7b0]">Manter o nome e os dados da opção marcada</span>' +
        '<button type="button" onclick="metaMergeAlbums(' + gi + ')" class="px-3.5 py-1.5 rounded-full text-xs font-extrabold bg-[#3b8cff] text-black hover:bg-[#5aa0ff] transition">Mesclar em "' + esc(g.variants[ci].name).slice(0, 30) + '"</button></div></div>';
    });
    out += '</div>';

    // artistas
    out += '<div><h2 class="font-display font-bold text-lg text-white mb-2.5">Artistas com grafias diferentes (' + r.artistGroups.length + ')</h2>';
    if (!r.artistGroups.length) out += '<div class="text-sm text-[#3b8cff]">✓ Nenhum artista repetido.</div>';
    r.artistGroups.forEach(function (g, gi) {
      var ci = pickOf('r' + gi, g.variants.length);
      out += '<div class="bg-[#18181f] border border-white/[0.06] rounded-2xl p-3 mb-3">' +
        g.variants.map(function (v, vi) {
          var row = '<div class="min-w-0 flex-1 text-sm font-bold text-white truncate">' + esc(v.name) + '</div>' +
            '<span class="text-xs text-[#a7a7b0]">' + v.tracks + ' faixas · ' + (v.albums || []).length + ' álbuns</span>';
          return variantRow(row, 'rg' + gi, vi === ci, 'metaPick(\'r' + gi + '\',' + vi + ')');
        }).join('') +
        '<div class="flex justify-end px-2 pt-2"><button type="button" onclick="metaMergeArtists(' + gi + ')" class="px-3.5 py-1.5 rounded-full text-xs font-extrabold bg-[#3b8cff] text-black hover:bg-[#5aa0ff] transition">Unificar como "' + esc(g.variants[ci].name).slice(0, 30) + '"</button></div></div>';
    });
    out += '</div>';

    // sem código
    var noCodeAll = activeList('noMbid'), noCode = noCodeAll.slice(0, 40), noCodeIgn = ignoredList('noMbid');
    out += '<div><div class="flex flex-wrap items-center justify-between gap-2 mb-2.5"><h2 class="font-display font-bold text-lg text-white">Álbuns sem código MusicBrainz (' + noCodeAll.length + ')</h2>' +
      '<div class="flex gap-2"><button type="button" onclick="metaSuggestAll()" class="px-3.5 py-1.5 rounded-full text-xs font-bold bg-white/10 hover:bg-white/15 text-white transition">Sugerir para todos</button>' +
      '<button type="button" onclick="metaApplyExact()" class="px-3.5 py-1.5 rounded-full text-xs font-extrabold bg-[#3b8cff] text-black hover:bg-[#5aa0ff] transition">Aplicar sugestões exatas</button></div></div>';
    if (!noCode.length) out += '<div class="text-sm text-[#3b8cff]">✓ ' + (noCodeIgn.length ? 'Nenhum pendente (' + noCodeIgn.length + ' ignorado' + (noCodeIgn.length > 1 ? 's' : '') + ').' : 'Todos os álbuns têm código.') + '</div>';
    out += '<div class="space-y-2">' + noCode.map(function (v, i) {
      var sg = meta.sugg[v.id], busyRow = meta.suggBusy[v.id];
      var sugHtml = busyRow ? '<div class="text-xs text-[#a7a7b0] pulse-green px-2 py-2">Buscando…</div>'
        : sg === undefined ? ''
        : !sg.length ? '<div class="text-xs text-[#a7a7b0] px-2 py-2">Nada parecido no MusicBrainz.</div>'
        : sg.map(function (it, si) {
          var exact = nk(it.title) === nk(v.name) && nk(it.artist) === nk(v.artist);
          return '<div class="flex items-center gap-3 p-2 rounded-lg bg-black/30">' +
            '<img src="' + caaCover(it.coverId, 250) + '" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'" class="w-10 h-10 rounded object-cover bg-white/5 flex-shrink-0" />' +
            '<div class="min-w-0 flex-1"><div class="text-xs font-bold text-white truncate">' + esc(it.title) + (exact ? ' <span class="text-[#3b8cff]">· exato</span>' : '') + '</div>' +
            '<div class="text-[11px] text-[#a7a7b0] truncate">' + esc(it.artist) + (it.year ? ' · ' + it.year : '') + (it.type ? ' · ' + esc(it.type) : '') + '</div></div>' +
            '<button type="button" onclick="metaApply(' + i + ',' + si + ')" class="px-3 py-1 rounded-full text-[11px] font-extrabold bg-white/10 hover:bg-[#3b8cff] hover:text-black text-white transition flex-shrink-0">Aplicar</button></div>';
        }).join('');
      return '<div class="bg-[#18181f] border border-white/[0.06] rounded-2xl p-3"><div class="flex items-center gap-3">' +
        '<img src="' + coverUrl(v.id, 80) + '" alt="" class="w-11 h-11 rounded object-cover bg-white/5 flex-shrink-0" />' +
        '<div class="min-w-0 flex-1"><div class="text-sm font-bold text-white truncate">' + esc(v.name) + '</div>' +
        '<div class="text-xs text-[#a7a7b0] truncate">' + esc(v.artist) + ' · ' + v.songs + ' faixas' + (v.year ? ' · ' + v.year : '') + '</div></div>' +
        '<div class="flex gap-1.5 flex-shrink-0"><button type="button" onclick="metaSuggest(' + i + ')" class="px-3 py-1.5 rounded-full text-xs font-bold bg-white/10 hover:bg-white/15 text-white transition">Sugerir</button>' +
        '<button type="button" onclick="openMetadataModalForAlbum(\'' + esc(v.id) + '\')" class="px-3 py-1.5 rounded-full text-xs font-bold bg-white/10 hover:bg-white/15 text-white transition">Editar</button>' +
        '<button type="button" onclick="metaIgnore(\'noMbid\',\'' + esc(v.id) + '\')" title="Não tem código no MusicBrainz (ex.: bootleg, coletânea): parar de listar" class="px-3 py-1.5 rounded-full text-xs font-bold text-[#a7a7b0] hover:text-white hover:bg-white/10 transition">Ignorar</button></div></div>' +
        (sugHtml ? '<div class="mt-2 space-y-1.5">' + sugHtml + '</div>' : '') + '</div>';
    }).join('') + '</div>' +
      (noCodeAll.length > 40 ? '<div class="text-xs text-[#a7a7b0] mt-2">Mostrando 40 de ' + noCodeAll.length + '. Aplique estes e analise de novo.</div>' : '') +
      ignoredBlock('noMbid', noCodeIgn) + '</div>';

    // sem capa
    var noCoverAll = activeList('noCover'), noCover = noCoverAll.slice(0, 40), noCoverIgn = ignoredList('noCover'), noCoverTotal = noCoverAll.length + (r.noCoverTotal > (r.noCover || []).length ? r.noCoverTotal - (r.noCover || []).length : 0);
    out += '<div><div class="flex flex-wrap items-center justify-between gap-2 mb-2.5"><h2 class="font-display font-bold text-lg text-white">Álbuns sem capa (' + noCoverTotal + ')</h2>' +
      (noCover.length ? '<button type="button" onclick="metaFetchAllCovers()" class="px-3.5 py-1.5 rounded-full text-xs font-extrabold bg-[#3b8cff] text-black hover:bg-[#5aa0ff] transition">Buscar todas as capas</button>' : '') + '</div>';
    if (!noCover.length) out += '<div class="text-sm text-[#3b8cff]">✓ ' + (noCoverIgn.length ? 'Nenhum pendente (' + noCoverIgn.length + ' ignorado' + (noCoverIgn.length > 1 ? 's' : '') + ').' : 'Todos os álbuns têm capa.') + '</div>';
    out += '<div class="bg-[#18181f] rounded-2xl border border-white/[0.05] divide-y divide-white/[0.05]">' + noCover.map(function (v, i) {
      var st = meta.cover[v.id];
      var btn = st === 'busy' ? '<span class="text-xs text-[#a7a7b0] pulse-green px-2">Buscando…</span>'
        : '<div class="flex gap-1.5 flex-shrink-0"><button type="button" onclick="metaFetchCover(' + i + ')" class="px-3 py-1.5 rounded-full text-xs font-bold bg-white/10 hover:bg-[#3b8cff] hover:text-black text-white transition">' + (v.stale ? 'Corrigir' : st === 'none' ? 'Tentar de novo' : 'Buscar capa') + '</button>' +
          '<label class="px-3 py-1.5 rounded-full text-xs font-bold bg-white/10 hover:bg-white/20 text-white cursor-pointer transition">Enviar capa…<input type="file" accept="image/jpeg,image/png" class="hidden" onchange="metaUploadCover(' + i + ',this)" /></label>' +
          '<button type="button" onclick="metaIgnore(\'noCover\',\'' + esc(v.id) + '\')" title="Este álbum não tem capa mesmo: parar de listar" class="px-3 py-1.5 rounded-full text-xs font-bold text-[#a7a7b0] hover:text-white hover:bg-white/10 transition">Ignorar</button></div>';
      return '<div class="flex items-center gap-3 p-2.5"><div class="w-11 h-11 rounded bg-white/5 flex-shrink-0 flex items-center justify-center text-[#a7a7b0] text-lg">♪</div>' +
        '<div class="min-w-0 flex-1"><div class="text-sm font-bold text-white truncate">' + esc(v.name) + '</div>' +
        '<div class="text-[11px] text-[#a7a7b0] truncate">' + esc(v.artist) + ' · ' + v.songs + ' faixas' + (v.mbzReleaseGroupId || v.mbzAlbumId ? ' · com código' : '') + '</div>' +
        (v.stale ? '<div class="text-[11px] text-amber-300">A capa existe nos arquivos, mas o Guitarr guardou um caminho velho. "Corrigir" resolve na hora.</div>' : '') +
        (st === 'none' ? '<div class="text-[11px] text-amber-300">Nada encontrado nas fontes.</div>' : '') + '</div>' + btn + '</div>';
    }).join('') + '</div>' +
      (noCoverTotal > 40 ? '<div class="text-xs text-[#a7a7b0] mt-2">Mostrando 40 de ' + noCoverTotal + '. Busque estas e analise de novo.</div>' : '') +
      ignoredBlock('noCover', noCoverIgn) + '</div>';

    // sem tags
    var fillable = r.unknown.filter(function (u) { return guessFromPath(u); }).length;
    out += '<div><div class="flex flex-wrap items-center justify-between gap-2 mb-2.5"><h2 class="font-display font-bold text-lg text-white">Faixas sem tags (' + r.unknown.length + ')</h2>' +
      (fillable ? '<button type="button" onclick="metaFillAll()" class="px-3.5 py-1.5 rounded-full text-xs font-extrabold bg-[#3b8cff] text-black hover:bg-[#5aa0ff] transition">Preencher pela pasta (' + fillable + ')</button>' : '') + '</div>';
    if (!r.unknown.length) out += '<div class="text-sm text-[#3b8cff]">✓ Todas as faixas têm álbum e artista.</div>';
    out += '<div class="bg-[#18181f] rounded-2xl border border-white/[0.05] divide-y divide-white/[0.05]">' +
      r.unknown.slice(0, 60).map(function (u, ui) {
        var g = guessFromPath(u);
        var hint = g ? '<div class="text-[11px] text-[#3b8cff] truncate">Pela pasta: ' + esc((g.artist || u.artist) + ' — ' + (g.album || u.album)) + '</div>' : '';
        return '<div class="flex items-center gap-3 p-2.5"><div class="min-w-0 flex-1"><div class="text-sm font-bold text-white truncate">' + esc(u.title) + '</div>' +
          '<div class="text-[11px] text-[#a7a7b0] truncate">' + esc(u.path) + '</div>' + hint + '</div>' +
          (g ? '<button type="button" onclick="metaFillPath(' + ui + ')" class="px-3 py-1 rounded-full text-[11px] font-extrabold bg-[#3b8cff] text-black hover:bg-[#5aa0ff] flex-shrink-0">Usar pasta</button>' : '') +
          '<button type="button" onclick="openMetadataModal(\'' + esc(u.id) + '\')" class="px-3 py-1 rounded-full text-[11px] font-bold bg-white/10 hover:bg-white/20 text-white flex-shrink-0">Editar tags</button></div>';
      }).join('') + '</div></div>';
    // registros fantasmas
    var mm = meta.missing || { total: 0, items: [] };
    out += '<div><div class="flex flex-wrap items-center justify-between gap-2 mb-2.5"><h2 class="font-display font-bold text-lg text-white">Registros de arquivos ausentes (' + mm.total + ')</h2>' +
      (mm.total ? '<button type="button" onclick="metaPurgeMissing()" class="px-3.5 py-1.5 rounded-full text-xs font-extrabold bg-red-400 text-black hover:bg-red-300 transition">Apagar ' + mm.total + ' registro' + (mm.total > 1 ? 's' : '') + '</button>' : '') + '</div>';
    if (!mm.total) out += '<div class="text-sm text-[#3b8cff]">✓ Nenhum registro fantasma.</div>';
    else out += '<div class="text-xs text-[#a7a7b0] mb-2">Faixas que o banco ainda lista, mas cujo arquivo não existe mais (renomeadas, re-etiquetadas ou apagadas). A interface já as esconde; apagar só limpa o banco.</div>' +
      '<div class="bg-[#18181f] rounded-2xl border border-white/[0.05] divide-y divide-white/[0.05]">' + mm.items.map(function (u) {
        return '<div class="p-2.5 min-w-0"><div class="text-sm font-bold text-white truncate">' + esc(u.title || '') + '</div>' +
          '<div class="text-[11px] text-[#a7a7b0] truncate">' + esc(u.path || '') + '</div></div>';
      }).join('') + '</div>' + (mm.total > mm.items.length ? '<div class="text-xs text-[#a7a7b0] mt-2">Mostrando ' + mm.items.length + ' de ' + mm.total + '.</div>' : '');
    out += '</div>';
    return out + '</div>' + busy;
  }

  // ---------------------------------------------------------- render guard ---
  var origRenderCurrentView = window.renderCurrentView;
  function styleNavMeta(active) {
    var b = $('nav-meta');
    if (!b) return;
    b.className = 'nav-btn group flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-all ' +
      (active ? 'font-bold bg-white/[0.1] text-white' : 'font-semibold text-[#a7a7b0] hover:text-white hover:bg-white/[0.05]');
    var ic = b.querySelector('.nav-icon');
    if (ic) ic.classList.toggle('text-[#3b8cff]', active);
  }
  window.renderCurrentView = function () {
    try {
      if (state.currentView === 'cfg') {
        updateNavHighlight();
        var cc = $('view-content');
        if (cc) cc.innerHTML = renderCfgView();
        styleNavMeta(false);
        styleNavCfg(true);
        if (!cfg.view && !cfg.loading && !cfg.error) loadCfg();
        return;
      }
      if (state.currentView === 'meta') {
        updateNavHighlight();
        var mc = $('view-content');
        if (mc) mc.innerHTML = window.renderMetaView();
        styleNavMeta(true);
        styleNavCfg(false);
        if (!meta.report && !meta.loading && !meta.error) loadMetaReport();
        return;
      }
      origRenderCurrentView();
      styleNavMeta(false);
      styleNavCfg(false);
      drawCatalogBlock();
    }
    catch (e) {
      var c = $('view-content');
      if (c) c.innerHTML = '<div class="py-12 text-center text-sm text-red-300">Erro ao desenhar esta tela: ' + esc(errMsg(e)) + '</div>';
      if (window.console) console.error(e);
    }
    sessLater();
  };

  // ------------------------------------- sessão: continuar de onde parou ---
  // O estado (faixa, posição, fila, tela aberta) fica no servidor em /api/seer/state, por usuário:
  // recarregar a página ou abrir em outro navegador/celular retoma de onde estava.
  // "playback" é compartilhado com o app mobile; "web" é só desta interface.
  var sess = { ready: false, restored: false, sig: '', pos: 0, at: 0, timer: null };
  var SESS_VIEWS = { songs: 1, albums: 1, artists: 1, albumDetail: 1, artistDetail: 1, playlistDetail: 1,
    seer: 1, podcasts: 1, radios: 1, meta: 1 };

  function sessSnapshot() {
    var snap = {
      web: {
        view: state.currentView, albumId: state.selectedAlbumId, artistName: state.selectedArtistName,
        playlistId: state.selectedPlaylistId, songFilter: state.songFilter, albumPreset: state.albumPreset
      }
    };
    var t = ext === null ? TRACKS[state.currentTrackIndex] : null;
    if (t) {
      snap.playback = {
        trackId: t.id, pos: Math.round(state.currentTimeSec || 0), shuffle: !!state.isShuffle, repeat: !!state.isRepeat,
        queue: queue ? queue.map(function (i) { return TRACKS[i] && TRACKS[i].id; }).filter(Boolean).slice(0, 500) : null,
        device: 'web'
      };
    }
    return snap;
  }
  function sessSave(force) {
    if (!auth || !sess.ready) return;
    var snap = sessSnapshot();
    var pos = snap.playback ? snap.playback.pos : 0;
    var sig = JSON.stringify(snap, function (k, v) { return k === 'pos' ? undefined : v; });
    var now = Date.now();
    if (!force && sig === sess.sig && Math.abs(pos - sess.pos) < 5) return;
    if (!force && now - sess.at < 1500) { sessLater(); return; }
    sess.sig = sig; sess.pos = pos; sess.at = now;
    try {
      fetch('/api/seer/state', {
        method: 'PUT', keepalive: true,
        headers: { 'x-nd-authorization': 'Bearer ' + auth.token, 'Content-Type': 'application/json' },
        body: JSON.stringify(snap)
      }).catch(function () {});
    } catch (e) {}
  }
  function sessLater() {
    if (sess.timer) return;
    sess.timer = setTimeout(function () { sess.timer = null; sessSave(false); }, 1600);
  }
  async function sessRestore() {
    if (sess.restored || !auth) return;
    sess.restored = true;
    var st = null;
    try { st = await apiJson('/api/seer/state'); } catch (e) {}
    try { if (st) sessApply(st); } catch (e) { if (window.console) console.error(e); }
    sess.ready = true;
    sess.sig = JSON.stringify(sessSnapshot(), function (k, v) { return k === 'pos' ? undefined : v; });
  }
  function sessApply(st) {
    var pb = st.playback, w = st.web;
    if (st.prefs && window.seerLangFromAccount && window.seerLangFromAccount(st.prefs.lang)) return;
    if (st.theme && st.theme.name && window.seerTheme && st.theme.name !== window.seerTheme.get()) window.seerTheme.set(st.theme.name, true);
    if (w && !window.location.hash && SESS_VIEWS[w.view]) {
      var ok = true;
      if (w.view === 'albumDetail') { ok = ALBUMS.some(function (a) { return a.id === w.albumId; }); if (ok) state.selectedAlbumId = w.albumId; }
      else if (w.view === 'artistDetail') { ok = ARTISTS.some(function (a) { return a.name === w.artistName; }); if (ok) state.selectedArtistName = w.artistName; }
      else if (w.view === 'playlistDetail') { ok = PLAYLISTS.some(function (p) { return p.id === w.playlistId; }); if (ok) state.selectedPlaylistId = w.playlistId; }
      if (ok && w.view !== 'meta') {
        state.currentView = w.view;
        state.viewHistory = ['songs', w.view]; state.historyIndex = 1;
      }
      if (w.songFilter) state.songFilter = w.songFilter;
      if (w.albumPreset) state.albumPreset = w.albumPreset;
    }
    if (pb && pb.trackId) {
      var idx = TRACKS.findIndex(function (t) { return t.id === pb.trackId; });
      if (idx >= 0) {
        state.currentTrackIndex = idx;
        state.currentTimeSec = Math.max(0, Number(pb.pos) || 0);
        state.isShuffle = !!pb.shuffle; state.isRepeat = !!pb.repeat;
        state.isPlaying = false;
        if (pb.queue && pb.queue.length) {
          var byId = {};
          TRACKS.forEach(function (t, i) { byId[t.id] = i; });
          var q = pb.queue.map(function (id) { return byId[id]; }).filter(function (i) { return i !== undefined; });
          if (q.indexOf(idx) >= 0) queue = q;
        }
        loadedKey = null;
        syncAudio();
      }
    }
    renderSidebarPlaylists();
    updatePlayerUI();
    renderCurrentView();
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') sessSave(true); });
  window.addEventListener('pagehide', function () { sessSave(true); });
  audio.addEventListener('timeupdate', function () { if (Date.now() - sess.at > 5000) sessSave(false); });
  audio.addEventListener('pause', function () { sessLater(); });
  audio.addEventListener('play', function () { sessLater(); });

  // ------------------------------------------------------------------ boot ---
  async function boot() {
    try {
      await loadLibrary();
    } catch (e) {
      if (!auth) return;
      toast('Erro ao carregar a biblioteca: ' + errMsg(e));
    }
    refreshChrome();
    await sessRestore();
    refreshStorage();
    refreshRequests();
    if (!seer.polling) {
      seer.polling = setInterval(function () {
        if (!auth) return;
        var active = seer.requests.some(function (r) { return isActive(r.status); });
        if (active || state.currentView === 'seer') refreshRequests();
        // espaço usado: a cada minuto enquanto algo baixa, senão a cada 5 min
        seer.storageTick = (seer.storageTick || 0) + 1;
        if (seer.storageTick % (active ? 12 : 60) === 0) refreshStorage();
      }, 5000);
    }
    setTimeout(maybeStartTour, 1200);
  }

  // ---------------------------------------------------------------- letras ---
  // Ordem: letra do servidor (OpenSubsonic getLyricsBySongId: .lrc/.txt ao lado do arquivo ou tag),
  // e se não houver ou não for sincronizada, o LRCLIB (via /api/seer/lyrics/{id}/lrclib).
  // Cache por sessão; painel "Tocando agora", modo imersivo em tela cheia e editor (admin).
  var lyr = { id: null, data: null, cache: {}, active: -1, full: false, raf: 0, batch: null, batchTimer: 0 };

  function parseLRC(text) {
    var lines = [], offset = 0;
    String(text || '').split(/\r?\n/).forEach(function (raw) {
      var off = raw.match(/^\[offset:\s*([+-]?\d+)\]/i);
      if (off) { offset = parseInt(off[1], 10) / 1000; return; }
      var re = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g, m, times = [], last = 0;
      while ((m = re.exec(raw))) { times.push(parseInt(m[1], 10) * 60 + parseFloat(m[2].replace(':', '.'))); last = re.lastIndex; }
      if (!times.length) return;
      var txt = raw.slice(last).replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, '').trim();
      times.forEach(function (t) { lines.push({ t: t, text: txt }); });
    });
    lines.forEach(function (l) { l.t = Math.max(0, l.t - offset); });
    lines.sort(function (a, b) { return a.t - b.t; });
    return lines;
  }
  function toLRC(lines) {
    return lines.map(function (l) {
      var m = Math.floor(l.t / 60), s = l.t - m * 60;
      return '[' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s.toFixed(2) + '] ' + l.text;
    }).join('\n');
  }
  function plainLines(text) {
    return String(text || '').split(/\r?\n/).map(function (s) { return { t: -1, text: s.trim() }; });
  }
  function pickCandidate(cands, sec) {
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
    if (lyr.cache[t.id]) return lyr.cache[t.id];
    var out = { synced: false, lines: [], source: '', raw: '' };
    try {
      var d = await subsonic('getLyricsBySongId', { id: t.id });
      var list = (d.lyricsList && d.lyricsList.structuredLyrics) || [];
      var s = list.find(function (x) { return x.synced; }) || list[0];
      if (s && s.line && s.line.length) {
        out.synced = !!s.synced;
        out.lines = s.line.map(function (l) { return { t: s.synced ? (l.start || 0) / 1000 - (s.offset || 0) / 1000 : -1, text: l.value || '' }; });
        out.raw = out.synced ? toLRC(out.lines) : out.lines.map(function (l) { return l.text; }).join('\n');
        out.source = 'arquivo';
      }
    } catch (e) {}
    if (!out.synced) {
      try {
        var cands = await apiJson('/api/seer/lyrics/' + encodeURIComponent(t.id) + '/lrclib');
        var c = pickCandidate(cands || [], t.sec);
        if (c && (c.synced || !out.lines.length)) {
          out = c.synced ? { synced: true, lines: parseLRC(c.synced), raw: c.synced, source: 'LRCLIB' }
            : { synced: false, lines: plainLines(c.plain), raw: c.plain, source: 'LRCLIB' };
        }
      } catch (e) {}
    }
    lyr.cache[t.id] = out;
    return out;
  }
  function lyricsTrack() { return ext ? null : currentTrack(); }
  async function loadLyricsFor(t) {
    lyr.id = t ? t.id : null; lyr.data = null; lyr.active = -1;
    renderLyrics();
    if (!t) return;
    var d = await fetchLyrics(t);
    if (lyr.id !== t.id) return;
    lyr.data = d;
    renderLyrics();
  }
  function lineHtml(l, i, big) {
    var base = big ? 'lyr-line block w-full text-left py-2 text-2xl sm:text-3xl lg:text-4xl font-extrabold leading-snug transition-all duration-300 origin-left'
      : 'lyr-line block w-full text-left py-1 text-sm font-semibold leading-snug transition-all duration-300 origin-left';
    var click = lyr.data && lyr.data.synced ? ' onclick="lyricsSeek(' + i + ')"' : '';
    return '<button type="button" data-i="' + i + '"' + click + ' class="' + base + ' ' + (lyr.data && lyr.data.synced ? 'opacity-40 blur-[0.5px] hover:opacity-80 cursor-pointer' : 'opacity-90 cursor-default') + '">' +
      (esc(l.text) || '♪') + '</button>';
  }
  function lyricsBody(big) {
    var t = lyricsTrack();
    if (!t) return '<div class="text-xs text-[#a7a7b0] py-4">Sem letra para rádio e podcast.</div>';
    if (!lyr.data) return '<div class="text-xs text-[#a7a7b0] py-4 pulse-green">Procurando a letra…</div>';
    if (!lyr.data.lines.length) {
      return '<div class="text-xs text-[#a7a7b0] py-4">Nenhuma letra encontrada' + (auth && auth.isAdmin
        ? '. <button type="button" onclick="openLyricsEditor()" class="text-[#3b8cff] font-bold hover:underline">Adicionar manualmente</button>' : '.') + '</div>';
    }
    return lyr.data.lines.map(function (l, i) { return lineHtml(l, i, big); }).join('');
  }
  function renderLyrics() {
    var box = $('np-lyrics');
    if (box) {
      box.innerHTML = lyricsBody(false);
      box.scrollTop = 0;
      setText('np-lyrics-source', lyr.data && lyr.data.lines.length ? (lyr.data.synced ? 'Sincronizada' : 'Texto') + ' · ' + lyr.data.source : '');
    }
    if (lyr.full) renderLyricsFull();
    lyr.active = -1;
    lyricsTick(true);
  }
  function activeIndex(sec) {
    var lines = lyr.data && lyr.data.synced ? lyr.data.lines : null;
    if (!lines || !lines.length) return -1;
    var lo = 0, hi = lines.length - 1, ans = -1;
    while (lo <= hi) { var mid = (lo + hi) >> 1; if (lines[mid].t <= sec + 0.15) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    return ans;
  }
  function highlight(container, i, big) {
    if (!container) return;
    var prev = container.querySelector('.lyr-on');
    if (prev) { prev.classList.remove('lyr-on', 'opacity-100', 'scale-105', 'font-black', 'text-white'); prev.classList.add('opacity-40', 'blur-[0.5px]'); }
    var el = i >= 0 ? container.querySelector('[data-i="' + i + '"]') : null;
    if (!el) return;
    el.classList.remove('opacity-40', 'blur-[0.5px]');
    el.classList.add('lyr-on', 'opacity-100', 'scale-105', 'text-white', big ? 'font-black' : 'font-bold');
    // rola só o contêiner da letra (scrollIntoView rolaria a página inteira)
    var top = el.offsetTop - container.clientHeight / 2 + el.clientHeight / 2;
    try { container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' }); } catch (e) { container.scrollTop = top; }
  }
  function lyricsTick(force) {
    if (!lyr.data || !lyr.data.synced) return;
    var i = activeIndex(audio.currentTime || state.currentTimeSec || 0);
    if (i === lyr.active && !force) return;
    lyr.active = i;
    highlight($('np-lyrics'), i, false);
    highlight($('lyrics-full-lines'), i, true);
  }
  audio.addEventListener('timeupdate', function () { if (!lyr.full) lyricsTick(); });
  audio.addEventListener('seeked', function () { lyricsTick(true); });
  window.lyricsSeek = function (i) {
    var l = lyr.data && lyr.data.lines[i];
    if (!l || l.t < 0 || ext) return;
    state.currentTimeSec = l.t;
    try { audio.currentTime = l.t; } catch (e) {}
    if (!state.isPlaying) window.togglePlay();
    updateProgressUI();
    lyricsTick(true);
  };

  // --- modo imersivo: capa + controles à esquerda, letra à direita, cores do álbum
  function rafLoop() {
    if (!lyr.full) { lyr.raf = 0; return; }
    lyricsTick();
    var t = lyricsTrack();
    var bar = $('lyrics-full-bar');
    if (bar && t) bar.style.width = Math.min(100, 100 * (audio.currentTime || 0) / (audio.duration || t.sec || 1)) + '%';
    lyr.raf = requestAnimationFrame(rafLoop);
  }
  function albumColor(t) {
    var al = t && ALBUMS.find(function (a) { return a.id === t.albumId; });
    return (al && al.color) || '#3b8cff';
  }
  function renderLyricsFull() {
    var el = $('lyrics-full'); if (!el) return;
    var t = lyricsTrack();
    var c = albumColor(t);
    el.style.background = 'radial-gradient(120% 90% at 15% 20%, ' + hexToRgba(c, 0.55) + ' 0%, rgba(10,10,14,0.92) 55%, #050507 100%)';
    var playIcon = state.isPlaying ? '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>' : '<path d="M8 5v14l11-7z"/>';
    el.innerHTML =
      (t ? '<img src="' + t.cover + '" alt="" class="absolute inset-0 w-full h-full object-cover opacity-20 blur-3xl scale-110 pointer-events-none" />' : '') +
      '<div class="relative h-full grid grid-rows-[auto_minmax(0,1fr)] md:grid-rows-1 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-6 md:gap-12 p-5 sm:p-10">' +
      '<div class="flex md:flex-col items-center md:items-start md:justify-center gap-4 md:gap-6 min-w-0">' +
      (t ? '<img src="' + t.cover + '" alt="" class="w-24 h-24 md:w-full md:max-w-md md:h-auto aspect-square rounded-2xl object-cover shadow-2xl flex-shrink-0" />' : '') +
      '<div class="min-w-0 w-full md:max-w-md"><div class="font-display font-black text-xl md:text-3xl text-white truncate">' + (t ? t.title : '') + '</div>' +
      '<div class="text-sm md:text-base text-white/70 truncate">' + (t ? t.artist + ' · ' + t.album : '') + '</div>' +
      '<div class="mt-4 h-1.5 rounded-full bg-white/15 overflow-hidden"><div id="lyrics-full-bar" class="h-full bg-white rounded-full" style="width:0%"></div></div>' +
      '<div class="mt-4 flex items-center gap-5">' +
      '<button type="button" onclick="prevTrack()" title="Anterior" class="text-white/80 hover:text-white"><svg class="w-7 h-7" fill="currentColor" viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg></button>' +
      '<button type="button" onclick="togglePlay()" title="Tocar / pausar" class="w-14 h-14 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 transition"><svg class="w-7 h-7" fill="currentColor" viewBox="0 0 24 24">' + playIcon + '</svg></button>' +
      '<button type="button" onclick="nextTrack()" title="Próxima" class="text-white/80 hover:text-white"><svg class="w-7 h-7" fill="currentColor" viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg></button>' +
      (auth && auth.isAdmin ? '<button type="button" onclick="openLyricsEditor()" class="ml-auto px-3.5 py-1.5 rounded-full text-xs font-bold bg-white/10 hover:bg-white/20 text-white">Editar letra</button>' : '') +
      '</div></div></div>' +
      '<div id="lyrics-full-lines" class="relative min-h-0 overflow-y-auto pr-2 py-[30vh] md:py-[40vh] [mask-image:linear-gradient(transparent,black_18%,black_82%,transparent)]">' + lyricsBody(true) + '</div>' +
      '</div>' +
      '<button type="button" onclick="closeLyricsFull()" title="Fechar (Esc)" class="absolute top-4 right-4 w-10 h-10 rounded-full bg-black/40 hover:bg-black/60 text-white flex items-center justify-center">' +
      '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg></button>';
    lyr.active = -1;
    lyricsTick(true);
  }
  window.openLyricsFull = function () {
    var el = $('lyrics-full');
    if (!el) {
      el = document.createElement('div');
      el.id = 'lyrics-full';
      el.className = 'fixed inset-0 z-[60] overflow-hidden th-keep';
      document.body.appendChild(el);
    }
    el.style.display = '';
    lyr.full = true;
    renderLyricsFull();
    if (!lyr.raf) lyr.raf = requestAnimationFrame(rafLoop);
  };
  window.closeLyricsFull = function () {
    lyr.full = false;
    var el = $('lyrics-full'); if (el) el.style.display = 'none';
    lyr.active = -1; lyricsTick(true);
  };
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { if ($('lyrics-editor')) window.closeLyricsEditor(); else if (lyr.full) window.closeLyricsFull(); }
  });

  // --- editor: colar/escrever, buscar no LRCLIB, salvar ao lado do arquivo
  window.openLyricsEditor = function () {
    var t = lyricsTrack(); if (!t || !auth || !auth.isAdmin) return;
    window.closeLyricsEditor();
    var raw = (lyr.id === t.id && lyr.data && lyr.data.raw) || '';
    var m = document.createElement('div');
    m.id = 'lyrics-editor';
    m.className = 'fixed inset-0 z-[70] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4';
    m.innerHTML = '<div class="bg-[#1b1b22] border border-white/10 rounded-2xl max-w-2xl w-full p-6 shadow-2xl max-h-[92vh] flex flex-col">' +
      '<div class="flex items-start justify-between gap-3 mb-3"><div class="min-w-0"><h3 class="font-display font-extrabold text-lg text-white">Letra</h3>' +
      '<p class="text-xs text-[#a7a7b0] truncate">' + t.title + ' · ' + t.artist + '</p></div>' +
      '<button type="button" onclick="closeLyricsEditor()" class="text-[#a7a7b0] hover:text-white p-1">✕</button></div>' +
      '<p class="text-[11px] text-[#7a7a85] mb-2">Cole ou escreva. Com tempos no formato <code>[01:23.45] verso</code> ela fica sincronizada; sem tempos, vira texto. É salva ao lado do arquivo (.lrc ou .txt).</p>' +
      '<textarea id="lyrics-editor-text" spellcheck="false" class="flex-1 min-h-[260px] w-full px-3.5 py-3 rounded-xl bg-black/50 border border-white/15 text-sm text-white font-mono focus:border-[#3b8cff] focus:outline-none">' + esc(raw) + '</textarea>' +
      '<div class="flex flex-wrap items-center gap-2 mt-3">' +
      '<button type="button" onclick="lyricsStamp()" title="Põe o tempo atual da música no começo da linha do cursor e desce uma linha" class="px-3.5 py-2 rounded-full text-xs font-bold bg-white/10 hover:bg-white/15 text-white">⏱ Marcar tempo na linha</button>' +
      '<button type="button" onclick="lyricsSearchLrclib()" class="px-3.5 py-2 rounded-full text-xs font-bold bg-white/10 hover:bg-white/15 text-white">Buscar no LRCLIB</button>' +
      '<span class="flex-1"></span>' +
      '<button type="button" onclick="lyricsSave(true)" class="px-3.5 py-2 rounded-full text-xs font-bold bg-white/10 hover:bg-red-500/30 text-red-200">Apagar</button>' +
      '<button type="button" onclick="lyricsSave(false)" class="px-5 py-2 rounded-full text-xs font-extrabold bg-[#3b8cff] text-black hover:bg-[#5aa0ff]">Salvar</button></div>' +
      '<div id="lyrics-editor-results" class="mt-3 space-y-1.5 overflow-y-auto max-h-48"></div></div>';
    m.addEventListener('mousedown', function (e) { if (e.target === m) window.closeLyricsEditor(); });
    document.body.appendChild(m);
  };
  window.closeLyricsEditor = function () { var m = $('lyrics-editor'); if (m) m.remove(); };
  window.lyricsStamp = function () {
    var ta = $('lyrics-editor-text'); if (!ta) return;
    var v = ta.value, pos = ta.selectionStart;
    var start = v.lastIndexOf('\n', pos - 1) + 1, end = v.indexOf('\n', pos); if (end < 0) end = v.length;
    var line = v.slice(start, end).replace(/^(\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]\s*)+/, '');
    var stamp = toLRC([{ t: audio.currentTime || 0, text: '' }]).trim();
    ta.value = v.slice(0, start) + stamp + ' ' + line + v.slice(end);
    var next = ta.value.indexOf('\n', start); next = next < 0 ? ta.value.length : next + 1;
    ta.focus(); ta.setSelectionRange(next, next);
  };
  var lyrCands = [];
  window.lyricsSearchLrclib = async function () {
    var t = lyricsTrack(); var box = $('lyrics-editor-results'); if (!t || !box) return;
    box.innerHTML = '<div class="text-xs text-[#a7a7b0] pulse-green">Buscando no LRCLIB…</div>';
    try {
      lyrCands = await apiJson('/api/seer/lyrics/' + encodeURIComponent(t.id) + '/lrclib') || [];
      box.innerHTML = lyrCands.length ? lyrCands.map(function (c, i) {
        var dd = Math.round((c.duration || 0) - t.sec);
        return '<button type="button" onclick="lyricsUseCandidate(' + i + ')" class="w-full text-left p-2.5 rounded-xl bg-black/30 hover:bg-white/[0.06] flex items-center gap-3">' +
          '<span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase ' + (c.synced ? 'bg-[#3b8cff]/20 text-[#3b8cff]' : 'bg-white/10 text-[#a7a7b0]') + '">' + (c.synced ? 'Sincronizada' : 'Texto') + '</span>' +
          '<span class="min-w-0 flex-1"><span class="block text-sm font-bold text-white truncate">' + esc(c.title) + ' · ' + esc(c.artist) + '</span>' +
          '<span class="block text-[11px] text-[#a7a7b0] truncate">' + esc(c.album || '') + ' · ' + fmtDur(c.duration) + (dd ? ' (' + (dd > 0 ? '+' : '') + dd + 's)' : ' (mesma duração)') + '</span></span></button>';
      }).join('') : '<div class="text-xs text-[#a7a7b0]">Nada no LRCLIB para esta música. Cole a letra acima.</div>';
    } catch (e) { box.innerHTML = '<div class="text-xs text-red-300">LRCLIB indisponível: ' + esc(errMsg(e)) + '</div>'; }
  };
  window.lyricsUseCandidate = function (i) {
    var c = lyrCands[i], ta = $('lyrics-editor-text'); if (!c || !ta) return;
    ta.value = c.synced || c.plain || '';
    toast('Letra carregada. Revise e clique em Salvar.');
  };
  window.lyricsSave = async function (clear) {
    var t = lyricsTrack(); var ta = $('lyrics-editor-text'); if (!t || !ta) return;
    var text = clear ? '' : ta.value.trim();
    if (clear && !window.confirm('Apagar a letra salva desta música?')) return;
    var synced = parseLRC(text).length ? text : '';
    try {
      await api('/api/seer/lyrics/' + encodeURIComponent(t.id), { method: 'PUT', json: { synced: synced, plain: synced ? '' : text } });
      delete lyr.cache[t.id];
      window.closeLyricsEditor();
      toast(clear ? 'Letra apagada' : synced ? 'Letra sincronizada salva' : 'Letra salva');
      loadLyricsFor(t);
    } catch (e) { toast('Não salvou: ' + errMsg(e)); }
  };

  // --- lote em Organizar Metadados
  async function pollLyricsBatch() {
    clearTimeout(lyr.batchTimer);
    try { lyr.batch = await apiJson('/api/seer/lyrics-batch'); } catch (e) { return; }
    if (state.currentView === 'meta') { var c = $('lyrics-batch-card'); if (c) c.outerHTML = lyricsBatchCard(); }
    if (lyr.batch && lyr.batch.running) lyr.batchTimer = setTimeout(pollLyricsBatch, 2000);
  }
  window.metaFetchLyrics = async function () {
    try { lyr.batch = await apiJson('/api/seer/lyrics-batch', { method: 'POST' }); toast('Buscando letras no LRCLIB…'); }
    catch (e) { toast('Erro: ' + errMsg(e)); return; }
    lyr.cache = {};
    pollLyricsBatch();
  };
  function lyricsBatchCard() {
    var b = lyr.batch;
    if (!b && auth && auth.isAdmin && !lyr.batchAsked) { lyr.batchAsked = true; setTimeout(pollLyricsBatch, 0); }
    var info = !b || (!b.running && !b.total && !b.finished) ? 'Procura no LRCLIB a letra das músicas que não têm e salva um .lrc (sincronizada) ou .txt ao lado de cada arquivo.'
      : b.running ? 'Buscando… ' + b.done + ' de ' + b.total + ' · ' + b.synced + ' sincronizadas, ' + b.plain + ' em texto, ' + b.notFound + ' sem letra'
      : 'Última busca: ' + b.synced + ' sincronizadas e ' + b.plain + ' em texto salvas, ' + b.notFound + ' sem letra' + (b.failed ? ', ' + b.failed + ' com erro' : '') + (b.total === 0 ? ' (todas já tinham letra)' : '') + '.';
    var pct = b && b.total ? Math.round(100 * b.done / b.total) : 0;
    return '<div id="lyrics-batch-card" class="bg-[#18181f] border border-white/[0.06] rounded-2xl p-4 flex flex-wrap items-center gap-4">' +
      '<div class="min-w-0 flex-1"><div class="font-bold text-sm text-white">Letras</div><div class="text-[11px] text-[#a7a7b0]">' + esc(info) + '</div>' +
      (b && b.running ? '<div class="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden"><div class="h-full bg-[#3b8cff]" style="width:' + pct + '%"></div></div>' : '') + '</div>' +
      '<button type="button" onclick="metaFetchLyrics()" ' + (b && b.running ? 'disabled' : '') + ' class="px-4 py-2 rounded-full text-xs font-extrabold bg-[#3b8cff] text-black hover:bg-[#5aa0ff] disabled:opacity-50 transition">Buscar Letras Faltantes (LRCLIB)</button></div>';
  }

  // troca de faixa -> nova letra
  var lyrPrevUpdate = window.updatePlayerUI;
  window.updatePlayerUI = function () {
    lyrPrevUpdate.apply(this, arguments);
    var t = lyricsTrack();
    if ((t ? t.id : null) !== lyr.id) loadLyricsFor(t);
    else if (lyr.full) {
      var b = $('lyrics-full') && $('lyrics-full').querySelector('button[onclick="togglePlay()"] svg');
      if (b) b.innerHTML = state.isPlaying ? '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>' : '<path d="M8 5v14l11-7z"/>';
    }
  };

  // ------------------------------------------------- mixes: SmartRadio e Daylist ---
  // Tudo local: usa favoritos, contagem de plays, gêneros, BPM e datas que o Guitarr já tem.
  // SmartRadio toca em lotes de 30 e renova sozinho nas 5 últimas; as Daylists mudam com a hora.
  // As últimas 50 músicas geradas ficam no navegador para a próxima seleção vir diferente.
  var MIX_RECENT_KEY = 'seer_mix_recent';
  var mix = { mode: 'geral', radioQueue: null, seedBump: 0 };
  try { mix.seedBump = parseInt(localStorage.getItem('seer_mix_bump') || '0', 10) || 0; } catch (e) {}
  var RADIO_MODES = [['geral', 'Mix Geral'], ['descoberta', 'Descoberta'], ['favoritas', 'Favoritas'], ['energia', 'Energia'], ['relax', 'Relax / Acústico']];
  var G_ENERGY = /rock|punk|metal|hardcore|grunge|electr|eletr|dance|edm|house|techno|trance|drum|dubstep|funk|hip ?hop|rap|trap|reggaeton|ska/i;
  var G_RELAX = /acoustic|acústic|acustic|folk|ambient|jazz|bossa|mpb|chill|lo-?fi|classical|clássic|piano|soul|r&b|rnb|soft|ballad|balada|new age|singer/i;
  var SLOTS = {
    manha: { title: 'Café da Manhã Musical', short: 'Manhã', da: 'da Manhã', sub: 'Leve, acústico e sem pressa', re: /acoustic|acústic|acustic|mpb|indie|pop|folk|bossa|soft|singer|samba|reggae/i, bpm: [80, 118] },
    tarde: { title: 'Foco & Ritmo da Tarde', short: 'Tarde', da: 'da Tarde', sub: 'Instrumental, lo-fi, rock clássico e eletrônica', re: /instrumental|lo-?fi|classic rock|rock|electr|eletr|house|techno|trance|post|chill|soundtrack|trilha/i, week: true },
    noite: { title: 'Sessão da Noite', short: 'Noite', da: 'da Noite', sub: 'Seus gêneros principais e as mais bem avaliadas', top: true },
    madrugada: { title: 'Madrugada Chill', short: 'Madrugada', da: 'da Madrugada', sub: 'Ambient, jazz, post-rock, R&B e baladas', re: /ambient|jazz|post-rock|post rock|r&b|rnb|soul|ballad|balada|slow|blues|chill|piano|classical|lo-?fi|dream/i, bpm: [1, 95] }
  };
  function slotNow(h) {
    h = h === undefined ? new Date().getHours() : h;
    return h >= 5 && h < 12 ? 'manha' : h >= 12 && h < 18 ? 'tarde' : h >= 18 && h < 23 ? 'noite' : 'madrugada';
  }
  function hashStr(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function shuffled(list, rand) { var a = list.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rand() * (i + 1)); var x = a[i]; a[i] = a[j]; a[j] = x; } return a; }
  function recentMix() { try { return JSON.parse(localStorage.getItem(MIX_RECENT_KEY) || '[]'); } catch (e) { return []; } }
  function rememberMix(ids) {
    var r = recentMix().filter(function (id) { return ids.indexOf(id) < 0; }).concat(ids).slice(-50);
    try { localStorage.setItem(MIX_RECENT_KEY, JSON.stringify(r)); } catch (e) {}
  }
  function genreOf(t) { return t.genres || t.genre || ''; }
  function topGenres(n) {
    var score = {};
    TRACKS.forEach(function (t) {
      var w = (t.fav ? 5 : 0) + Math.min(t.plays || 0, 20) + (t.rating >= 4 ? 3 : 0);
      if (!w) return;
      genreOf(t).split(/\s*[\/;,]\s*/).forEach(function (g) { g = g.trim(); if (g) score[g] = (score[g] || 0) + w; });
    });
    return Object.keys(score).sort(function (a, b) { return score[b] - score[a]; }).slice(0, n);
  }
  function inGenres(t, gs) { var g = genreOf(t).toLowerCase(); return gs.some(function (x) { return g.indexOf(x.toLowerCase()) >= 0; }); }
  // Smart Shuffle: o mesmo artista não volta antes de 4 faixas (quando dá).
  function smartShuffle(list, rand) {
    // intercala por artista: a cada passo, o artista com mais faixas sobrando que não tocou nas últimas 3
    var byArtist = {}, order = [];
    shuffled(list, rand).forEach(function (t) {
      if (!byArtist[t.artist]) { byArtist[t.artist] = []; order.push(t.artist); }
      byArtist[t.artist].push(t);
    });
    var out = [];
    while (out.length < list.length) {
      var recent = out.slice(-3).map(function (t) { return t.artist; });
      var best = null, bestAny = null;
      order.forEach(function (a) {
        var n = byArtist[a].length; if (!n) return;
        if (!bestAny || n > byArtist[bestAny].length) bestAny = a;
        if (recent.indexOf(a) < 0 && (!best || n > byArtist[best].length)) best = a;
      });
      out.push(byArtist[best || bestAny].shift());
    }
    return out;
  }
  // pega n de "from" sem repetir o que já está em "taken" nem o histórico (se sobrar opção)
  function take(from, n, taken, rand, recent) {
    var free = from.filter(function (t) { return !taken[t.id]; });
    var fresh = free.filter(function (t) { return recent.indexOf(t.id) < 0; });
    var src = shuffled(fresh.length >= n ? fresh : free, rand);
    var out = src.slice(0, n);
    out.forEach(function (t) { taken[t.id] = 1; });
    return out;
  }
  function musicTracks() { return TRACKS.filter(function (t) { return !/(^|\/)podcasts\//i.test(t.path || ''); }); }
  function addedRecently(list) {
    var withDate = list.filter(function (t) { return t.added; }).sort(function (a, b) { return String(b.added).localeCompare(String(a.added)); });
    return withDate.slice(0, Math.max(30, Math.round(withDate.length * 0.1)));
  }
  // Gera um lote do SmartRadio.
  function radioBatch(mode, n, exclude, rand) {
    var all = musicTracks(), taken = {}, recent = recentMix(), out = [];
    (exclude || []).forEach(function (id) { taken[id] = 1; });
    var favs = all.filter(function (t) { return t.fav; });
    var played = all.filter(function (t) { return t.plays > 0; }).sort(function (a, b) { return b.plays - a.plays; });
    var tops = topGenres(5);
    if (mode === 'favoritas') out = take(all.filter(function (t) { return t.fav || t.rating >= 4; }), n, taken, rand, recent);
    else if (mode === 'descoberta') {
      var unplayed = all.filter(function (t) { return !t.plays; });
      out = take(unplayed.filter(function (t) { return inGenres(t, tops); }), Math.round(n / 2), taken, rand, recent);
      out = out.concat(take(unplayed.length ? unplayed : all.filter(function (t) { return t.plays <= 1; }), n - out.length, taken, rand, recent));
    } else if (mode === 'energia') out = take(all.filter(function (t) { return G_ENERGY.test(genreOf(t)) || t.bpm >= 120; }), n, taken, rand, recent);
    else if (mode === 'relax') out = take(all.filter(function (t) { return G_RELAX.test(genreOf(t)) || (t.bpm > 0 && t.bpm < 100); }), n, taken, rand, recent);
    else {
      // Mix Geral: 40% curtidas, 30% mais tocadas, 20% esquecidas dos gêneros favoritos, 10% recentes
      out = take(favs, Math.round(n * 0.4), taken, rand, recent);
      out = out.concat(take(played.slice(0, Math.max(40, Math.round(played.length * 0.25))), Math.round(n * 0.3), taken, rand, recent));
      out = out.concat(take(all.filter(function (t) { return !t.plays && inGenres(t, tops); }), Math.round(n * 0.2), taken, rand, recent));
      out = out.concat(take(addedRecently(all), n - out.length, taken, rand, recent));
    }
    if (out.length < n) out = out.concat(take(all, n - out.length, taken, rand, recent)); // completa com o resto da biblioteca
    return smartShuffle(out, rand);
  }
  // Daylists: a do horário + variações com os gêneros principais e as favoritas
  function daylists() {
    var slot = slotNow(), s = SLOTS[slot], all = musicTracks();
    var day = new Date().toISOString().slice(0, 10);
    var tops = topGenres(3), weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
    function base(t) {
      if (s.top) return inGenres(t, tops) || t.rating >= 4 || t.fav;
      if (s.week && t.lastPlayed && t.lastPlayed >= weekAgo) return true;
      return (s.re && s.re.test(genreOf(t))) || (s.bpm && t.bpm >= s.bpm[0] && t.bpm <= s.bpm[1]);
    }
    var mainPool = all.filter(base);
    var defs = [{ key: slot, title: s.title, sub: s.sub, pool: mainPool }];
    tops.slice(0, 2).forEach(function (g) {
      defs.push({ key: slot + ':' + g, title: g + ' · ' + s.short, sub: 'O melhor de ' + g + ' para agora',
        pool: all.filter(function (t) { return inGenres(t, [g]) && (base(t) || mainPool.length < 30); }) });
    });
    defs.push({ key: slot + ':fav', title: 'Favoritas ' + s.da, sub: 'Suas curtidas que combinam com o horário',
      pool: all.filter(function (t) { return t.fav && (base(t) || true); }) });
    return defs.slice(0, 4).map(function (d) {
      var rand = rng(hashStr(day + '|' + d.key + '|' + mix.seedBump));
      var recent = recentMix(), taken = {};
      var picks = take(d.pool, 30, taken, rand, recent);
      if (picks.length < 30) picks = picks.concat(take(all.filter(function (t) { return inGenres(t, tops); }), 30 - picks.length, taken, rand, recent));
      if (picks.length < 30) picks = picks.concat(take(all, 30 - picks.length, taken, rand, recent));
      picks = smartShuffle(picks, rand);
      var covers = [], seenAl = {};
      picks.forEach(function (t) { if (covers.length < 4 && !seenAl[t.albumId]) { seenAl[t.albumId] = 1; covers.push(t.cover); } });
      return { key: d.key, title: d.title, sub: d.sub, tracks: picks, covers: covers };
    });
  }
  var lastDaylists = null, daylistKey = '';
  function daylistsCached() {
    var key = new Date().toISOString().slice(0, 10) + '|' + slotNow() + '|' + mix.seedBump + '|' + TRACKS.length;
    if (key !== daylistKey || !lastDaylists) { daylistKey = key; lastDaylists = daylists(); }
    return lastDaylists;
  }
  function playList(list, label) {
    var idxs = list.map(function (t) { return TRACKS.indexOf(t); }).filter(function (i) { return i >= 0; });
    if (!idxs.length) { toast('Nada para tocar ainda: curta ou toque algumas músicas primeiro'); return; }
    rememberMix(list.map(function (t) { return t.id; }));
    queue = idxs;
    state.isShuffle = false;
    startTrack(idxs[0]);
    toast('Tocando ' + label);
    return idxs;
  }
  window.playSmartRadio = function (mode) {
    mix.mode = mode || mix.mode;
    var rand = rng(hashStr(Date.now() + '|' + mix.mode));
    var batch = radioBatch(mix.mode, 30, [], rand);
    var label = (RADIO_MODES.find(function (m) { return m[0] === mix.mode; }) || [, 'SmartRadio'])[1];
    mix.radioQueue = playList(batch, 'SmartRadio · ' + label) || null;
    renderCurrentView();
  };
  window.setSmartRadioMode = function (mode) { mix.mode = mode; window.playSmartRadio(mode); };
  window.playDaylist = function (i) {
    var d = daylistsCached()[i]; if (!d) return;
    mix.radioQueue = null;
    playList(d.tracks, '"' + d.title + '"');
  };
  window.refreshMixes = function () {
    mix.seedBump++;
    try { localStorage.setItem('seer_mix_bump', String(mix.seedBump)); } catch (e) {}
    (lastDaylists || []).forEach(function (d) { rememberMix(d.tracks.map(function (t) { return t.id; })); });
    lastDaylists = null;
    renderCurrentView();
    toast('Mixes atualizados');
  };
  // SmartRadio infinito: nas 5 últimas faixas do lote, emenda mais 30.
  var mixPrevNext = window.nextTrack;
  window.nextTrack = function () {
    if (mix.radioQueue && queue === mix.radioQueue) {
      var pos = queue.indexOf(state.currentTrackIndex);
      if (pos >= queue.length - 5) {
        var have = queue.map(function (i) { return TRACKS[i] && TRACKS[i].id; });
        var more = radioBatch(mix.mode, 30, have, rng(hashStr(Date.now() + '|more')));
        more.forEach(function (t) { var i = TRACKS.indexOf(t); if (i >= 0) queue.push(i); });
        rememberMix(more.map(function (t) { return t.id; }));
      }
    }
    return mixPrevNext.apply(this, arguments);
  };
  function mosaic(covers) {
    var c = covers.slice(0, 4);
    while (c.length && c.length < 4) c.push(c[c.length % Math.max(1, covers.length)] || c[0]);
    if (!c.length) return '<div class="w-full aspect-square rounded-xl bg-white/5"></div>';
    return '<div class="grid grid-cols-2 w-full aspect-square rounded-xl overflow-hidden shadow-lg">' + c.map(function (u) {
      return '<img src="' + u + '" alt="" loading="lazy" class="w-full h-full object-cover" />';
    }).join('') + '</div>';
  }
  window.seerMixesHtml = function () {
    if (!TRACKS.length || (state.searchQuery || '').trim()) return '';
    daylistsCached();
    var radioOn = mix.radioQueue && queue === mix.radioQueue;
    var chips = RADIO_MODES.map(function (m) {
      return '<button type="button" onclick="setSmartRadioMode(\'' + m[0] + '\')" class="px-3.5 py-1.5 rounded-full text-xs font-bold transition ' +
        (mix.mode === m[0] && radioOn ? 'bg-white text-black' : 'bg-white/10 hover:bg-white/20 text-white') + '">' + m[1] + '</button>';
    }).join('');
    var smartradio = '<div class="relative overflow-hidden rounded-2xl p-5 sm:p-6 border border-white/10 bg-gradient-to-br from-[#3b8cff]/35 via-[#5b3bff]/20 to-[#121218]">' +
      '<div class="absolute -right-10 -top-10 w-48 h-48 rounded-full bg-[#3b8cff]/30 blur-3xl pointer-events-none"></div>' +
      '<div class="relative flex flex-wrap items-center justify-between gap-4"><div class="min-w-0">' +
      '<div class="text-[11px] font-extrabold uppercase tracking-wider text-[#9cc4ff]">Mix infinito</div>' +
      '<h2 class="font-display font-black text-3xl text-white tracking-tight">SmartRadio</h2>' +
      '<p class="text-xs text-white/70 mt-1">Feito com o que você curte e toca, renovado sozinho enquanto ouve.' + (radioOn ? ' <span class="text-white font-bold">Tocando agora.</span>' : '') + '</p></div>' +
      '<button type="button" onclick="playSmartRadio()" class="h-12 px-6 rounded-full bg-white text-black font-extrabold text-sm flex items-center gap-2 hover:scale-105 transition"><svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>' + (radioOn ? 'Novo lote' : 'Tocar SmartRadio') + '</button></div>' +
      '<div class="relative flex flex-wrap gap-2 mt-4">' + chips + '</div></div>';
    var cards = lastDaylists.map(function (d, i) {
      return '<div onclick="playDaylist(' + i + ')" class="gt-card group p-3.5 rounded-2xl cursor-pointer">' +
        '<div class="relative mb-2.5">' + mosaic(d.covers) +
        '<button type="button" onclick="event.stopPropagation(); playDaylist(' + i + ')" class="play-fab absolute bottom-2 right-2 w-10 h-10 rounded-full bg-[#3b8cff] text-black flex items-center justify-center shadow-lg"><svg class="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button></div>' +
        '<div class="font-bold text-sm text-white truncate">' + esc(d.title) + '</div><div class="text-[11px] text-[#a7a7b0] truncate">' + esc(d.sub) + ' · ' + d.tracks.length + ' faixas</div></div>';
    }).join('');
    return '<div class="space-y-4">' + smartradio +
      '<div><div class="flex items-center justify-between mb-3"><div><h2 class="font-display font-bold text-lg text-white">Daylist</h2>' +
      '<div class="text-[11px] text-[#a7a7b0]">Muda com a hora do dia</div></div>' +
      '<button type="button" onclick="refreshMixes()" class="px-3.5 py-1.5 rounded-full text-xs font-bold bg-white/[0.08] hover:bg-white/[0.14] text-white">↻ Atualizar Mix</button></div>' +
      '<div class="grid grid-cols-2 md:grid-cols-4 gap-4">' + cards + '</div></div></div>';
  };
  window.seerMixInternals = { radioBatch: radioBatch, daylists: daylists, slotNow: slotNow, smartShuffle: smartShuffle, rng: rng, mix: mix, getQueue: function () { return queue; } };

  // ------------------------------------------------------- configurações ---
  // Tela de admin: aprovação automática (/api/seer/settings) e as fontes do .env que valem sem
  // reiniciar (/api/seer/config). Chaves e segredos só vão ao servidor quando digitados; lá ficam
  // criptografados, e a tela só sabe se estão salvos.
  var cfg = { settings: null, view: null, draft: {}, secrets: {}, loading: false, error: '', saving: false };
  var CFG_SECRET = { soulseekApiKey: 'soulseekApiKeySet', lidarrApiKey: 'lidarrApiKeySet', spotifyClientSecret: 'spotifyClientSecretSet',
    soulseekPassword: 'soulseekPasswordSet', slskdWebPassword: 'slskdWebPasswordSet' };
  var CFG_PLAIN = ['sources', 'youtubeEnabled', 'youtubeCookies', 'soundcloudEnabled', 'soulseekEnabled', 'soulseekUrl',
    'soulseekDownloads', 'soulseekPreferFlac', 'lidarrEnabled', 'lidarrUrl', 'lidarrRootFolder', 'spotifyClientId', 'minFreeSpace',
    'soulseekUsername', 'slskdWebUsername'];

  async function loadCfg() {
    cfg.loading = true; cfg.error = '';
    try {
      var r = await Promise.all([apiJson('/api/seer/settings'), apiJson('/api/seer/config')]);
      cfg.settings = r[0]; cfg.view = r[1]; cfg.draft = Object.assign({}, r[1]); cfg.secrets = {};
    } catch (e) { cfg.error = errMsg(e); }
    cfg.loading = false;
    if (state.currentView === 'cfg') renderCurrentView();
  }

  window.cfgToggleAutoApprove = async function (on) {
    try {
      cfg.settings = await apiJson('/api/seer/settings', { method: 'PUT', json: { autoApprove: !!on } });
      toast(on ? 'Pedidos entram direto na fila' : 'Pedidos esperam a aprovação de um admin');
    } catch (e) { toast('Não salvou: ' + errMsg(e)); }
    renderCurrentView();
  };
  window.cfgSet = function (key, value) { cfg.draft[key] = value; };
  window.cfgSecret = function (key, value) { cfg.secrets[key] = value; };
  window.cfgClearSecret = function (key) {
    cfg.secrets[key] = '';
    var el = $('cfg-secret-' + key); if (el) { el.value = ''; el.placeholder = 'será apagada ao salvar'; }
  };
  window.cfgSave = async function () {
    var patch = {};
    CFG_PLAIN.forEach(function (k) { if (cfg.draft[k] !== cfg.view[k]) patch[k] = cfg.draft[k]; });
    Object.keys(CFG_SECRET).forEach(function (k) { if (cfg.secrets[k] !== undefined) patch[k] = cfg.secrets[k]; });
    if (!Object.keys(patch).length) { toast('Nada mudou'); return; }
    cfg.saving = true; renderCurrentView();
    try {
      cfg.view = await apiJson('/api/seer/config', { method: 'PUT', json: patch });
      cfg.draft = Object.assign({}, cfg.view); cfg.secrets = {};
      toast('Configurações salvas e aplicadas');
    } catch (e) { toast('Não salvou: ' + errMsg(e)); }
    cfg.saving = false; renderCurrentView();
  };

  var CFG_INPUT = 'mt-1 w-full px-3.5 py-2.5 rounded-xl bg-black/50 border border-white/15 text-sm text-white focus:border-[#3b8cff] focus:outline-none';
  function cfgCard(title, body) {
    return '<div class="bg-[#18181f] border border-white/[0.06] rounded-2xl p-5 space-y-3">' +
      '<h2 class="font-display font-bold text-lg text-white">' + title + '</h2>' + body + '</div>';
  }
  function cfgText(key, label, hint) {
    return '<label class="block"><span class="text-xs font-semibold text-[#a7a7b0]">' + label + '</span>' +
      '<input value="' + esc(cfg.draft[key]) + '" oninput="cfgSet(\'' + key + '\', this.value)" class="' + CFG_INPUT + '" />' +
      (hint ? '<span class="block mt-1 text-[11px] text-[#7a7a85]">' + hint + '</span>' : '') + '</label>';
  }
  function cfgCheck(key, label) {
    return '<label class="flex items-center gap-3 cursor-pointer select-none"><input type="checkbox" ' + (cfg.draft[key] ? 'checked' : '') +
      ' onchange="cfgSet(\'' + key + '\', this.checked)" class="w-4 h-4 accent-[#3b8cff]" />' +
      '<span class="text-sm text-white">' + label + '</span></label>';
  }
  function cfgSecretInput(key, label, noClear) {
    var saved = cfg.view && cfg.view[CFG_SECRET[key]];
    return '<label class="block"><span class="text-xs font-semibold text-[#a7a7b0]">' + label + '</span>' +
      '<div class="flex items-center gap-2"><input id="cfg-secret-' + key + '" type="password" autocomplete="off" placeholder="' +
      (saved ? '•••••••• salva (deixe em branco para manter)' : 'não definida') + '" oninput="cfgSecret(\'' + key + '\', this.value)" class="' + CFG_INPUT + '" />' +
      (saved && !noClear ? '<button type="button" onclick="cfgClearSecret(\'' + key + '\')" class="mt-1 px-3 py-2 rounded-full text-xs font-bold bg-white/[0.08] hover:bg-white/[0.14] text-white">Apagar</button>' : '') +
      '</div></label>';
  }

  // Usuários: lista, cria e remove (API nativa /api/user, só admin) e troca a própria senha.
  var users = { list: null, loading: false, error: '' };
  async function loadUsers() {
    users.loading = true;
    try { users.list = await apiJson('/api/user?_start=0&_end=200&_sort=userName&_order=ASC'); users.error = ''; }
    catch (e) { users.list = []; users.error = errMsg(e); }
    users.loading = false;
    if (state.currentView === 'cfg') renderCurrentView();
  }
  function usersCard() {
    var rows = '';
    if (users.error) rows = '<div class="text-xs text-red-300">' + esc(users.error) + '</div>';
    else if (!users.list) rows = '<div class="text-xs text-[#a7a7b0] pulse-green">Carregando…</div>';
    else rows = users.list.map(function (u) {
      var me = auth && u.id === auth.id;
      return '<div class="flex items-center justify-between gap-3 py-1.5"><div class="min-w-0 text-sm text-white truncate">' + esc(u.userName) +
        (u.isAdmin ? ' <span class="text-[10px] px-2 py-0.5 rounded bg-white/10 text-[#a7a7b0] font-semibold">admin</span>' : '') +
        (me ? ' <span class="text-[10px] text-[#a7a7b0]">(você)</span>' : '') + '</div>' +
        (me ? '' : '<button type="button" onclick="usersDelete(\'' + esc(u.id) + '\', \'' + esc(u.userName) + '\')" class="text-xs font-bold text-red-300 hover:underline flex-shrink-0">Remover</button>') + '</div>';
    }).join('');
    return cfgCard('Usuários',
      '<p class="text-xs text-[#a7a7b0]">Quem pode entrar neste Guitarr. Cada usuário tem os próprios favoritos, playlists e ajustes.</p>' +
      '<div class="divide-y divide-white/[0.06]">' + rows + '</div>' +
      '<div class="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2">' +
      '<input id="usr-name" placeholder="Nome de usuário" autocomplete="off" class="' + CFG_INPUT + '" />' +
      '<input id="usr-pass" type="password" placeholder="Senha" autocomplete="new-password" class="' + CFG_INPUT + '" />' +
      '<label class="flex items-center gap-2 text-sm text-white select-none"><input id="usr-admin" type="checkbox" class="w-4 h-4 accent-[#3b8cff]" /> Administrador</label></div>' +
      '<div class="flex flex-wrap gap-2 pt-1"><button type="button" onclick="usersAdd()" class="px-4 py-2 rounded-full text-xs font-extrabold bg-[#3b8cff] hover:bg-[#5aa0ff] text-black">Adicionar usuário</button>' +
      '<button type="button" onclick="usersPassword()" class="px-4 py-2 rounded-full text-xs font-bold bg-white/[0.08] hover:bg-white/[0.14] text-white">Alterar minha senha</button></div>');
  }
  window.usersAdd = async function () {
    var name = ($('usr-name') || {}).value || '', pass = ($('usr-pass') || {}).value || '';
    name = name.trim();
    if (!name || pass.length < 6) { toast('Informe o usuário e uma senha de pelo menos 6 caracteres'); return; }
    try {
      await apiJson('/api/user', { method: 'POST', json: { userName: name, name: name, password: pass, isAdmin: !!$('usr-admin').checked } });
      toast('Usuário criado: ' + name);
      users.list = null; loadUsers();
    } catch (e) { toast('Erro ao criar usuário: ' + errMsg(e)); }
  };
  window.usersDelete = async function (id, name) {
    if (!window.confirm('Remover o usuário "' + unesc(name) + '"? As playlists e favoritos dele serão apagados.')) return;
    try { await api('/api/user/' + encodeURIComponent(unesc(id)), { method: 'DELETE' }); toast('Usuário removido'); users.list = null; loadUsers(); }
    catch (e) { toast('Erro ao remover: ' + errMsg(e)); }
  };
  window.usersPassword = async function () {
    var cur = window.prompt('Senha atual'); if (!cur) return;
    var nw = window.prompt('Nova senha (pelo menos 6 caracteres)'); if (!nw) return;
    if (nw.length < 6) { toast('Use uma senha com pelo menos 6 caracteres'); return; }
    try { await apiJson('/api/user/' + encodeURIComponent(auth.id), { method: 'PUT', json: { currentPassword: cur, password: nw } }); toast('Senha alterada'); }
    catch (e) { toast('Erro ao alterar a senha: ' + errMsg(e)); }
  };

  function renderCfgView() {
    if (!auth || !auth.isAdmin) return '<div class="py-12 text-center text-sm text-[#a7a7b0]">Somente administradores podem mudar as configurações.</div>';
    var head = '<div class="space-y-6 pb-10 max-w-3xl">' +
      '<div><h1 class="font-display font-black text-3xl text-white tracking-tight">Configurações</h1>' +
      '<p class="text-xs text-[#a7a7b0] mt-1">O que você salvar aqui vale na hora, sem reiniciar o servidor, e passa na frente do arquivo .env.</p></div>';
    if (cfg.loading || (!cfg.view && !cfg.error)) return head + '<div class="py-10 text-center text-sm text-[#a7a7b0] pulse-green">Carregando…</div></div>';
    if (cfg.error) return head + '<div class="text-sm text-red-300">' + esc(cfg.error) + '</div></div>';
    var auto = cfg.settings && cfg.settings.autoApprove;
    var out = head;
    out += cfgCard('Aparência',
      '<div data-theme-row class="flex gap-2 max-w-md">' + themeChips() + '</div>' +
      '<p class="text-xs text-[#a7a7b0]">Escuro, preto puro (economiza bateria em telas OLED) ou claro. Vale para a sua conta, aqui e no app do celular.</p>');
    out += cfgCard('Idioma',
      '<div class="flex gap-2 max-w-md">' + window.seerLangChips() + '</div>' +
      '<p class="text-xs text-[#a7a7b0]">Idioma da interface. Vale para a sua conta, aqui e no app do celular.</p>');
    out += cfgCard('Pedidos',
      '<label id="cfg-auto-approve" class="flex items-center gap-3 cursor-pointer select-none"><input type="checkbox" ' + (auto ? 'checked' : '') +
      ' onchange="cfgToggleAutoApprove(this.checked)" class="w-4 h-4 accent-[#3b8cff]" />' +
      '<span class="text-sm text-white font-semibold">Aprovar pedidos automaticamente</span></label>' +
      '<p class="text-xs text-[#a7a7b0]">Ligado: cada pedido entra direto na fila de download. Desligado: um admin precisa aprovar antes.</p>');
    out += cfgCard('Fontes de download',
      cfgText('sources', 'Fontes, em ordem de prioridade', 'Separadas por vírgula: soulseek, youtube, soundcloud, lidarr') +
      '<div class="grid grid-cols-2 gap-2 pt-1">' + cfgCheck('youtubeEnabled', 'YouTube') + cfgCheck('soundcloudEnabled', 'SoundCloud') +
      cfgCheck('soulseekEnabled', 'Soulseek') + cfgCheck('lidarrEnabled', 'Lidarr') + '</div>');
    out += cfgCard('Soulseek (slskd)',
      cfgText('soulseekUrl', 'Endereço do slskd') + cfgSecretInput('soulseekApiKey', 'Chave da API') +
      cfgText('soulseekDownloads', 'Pasta de downloads do slskd') + cfgCheck('soulseekPreferFlac', 'Preferir FLAC'));
    out += cfgCard('Conta Soulseek e painel do slskd', cfg.view.slskdConfig
      ? cfgText('soulseekUsername', 'Usuário do Soulseek', 'A conta é criada no primeiro login. Trocar usuário ou senha reconecta o slskd sozinho.') +
        cfgSecretInput('soulseekPassword', 'Senha do Soulseek', true) +
        cfgText('slskdWebUsername', 'Usuário do painel web do slskd (porta 5030)') +
        cfgSecretInput('slskdWebPassword', 'Senha do painel web do slskd', true) +
        '<span class="block text-[11px] text-[#7a7a85]">Gravado no slskd.yml do slskd (só o dono do arquivo lê). O slskd aplica sem reiniciar.</span>'
      : '<p class="text-xs text-[#a7a7b0]">Para editar aqui, monte o <code>slskd.yml</code> do slskd no Guitarr e defina <code>ND_SEER_SOULSEEK_CONFIGFILE</code>.</p>');
    out += cfgCard('YouTube',
      cfgText('youtubeCookies', 'Arquivo de cookies (opcional)', 'Para ler listas privadas, como "Músicas curtidas". Ex.: /data/youtube-cookies.txt'));
    out += cfgCard('Lidarr',
      cfgText('lidarrUrl', 'Endereço do Lidarr') + cfgSecretInput('lidarrApiKey', 'Chave da API') + cfgText('lidarrRootFolder', 'Pasta raiz'));
    out += cfgCard('Spotify (importar playlists)',
      cfgText('spotifyClientId', 'Client ID') + cfgSecretInput('spotifyClientSecret', 'Client secret'));
    if (!users.list && !users.loading && !users.error) setTimeout(loadUsers, 0);
    out += usersCard();
    out += cfgCard('Espaço em disco',
      cfgText('minFreeSpace', 'Espaço mínimo livre no disco', 'Abaixo disso os downloads param. Ex.: 5GB'));
    out += '<div class="flex flex-wrap items-center gap-4">' +
      '<button type="button" onclick="cfgSave()" ' + (cfg.saving ? 'disabled' : '') + ' class="px-6 py-2.5 rounded-full text-sm font-extrabold bg-[#3b8cff] text-black hover:bg-[#5aa0ff] transition">' +
      (cfg.saving ? 'Salvando…' : 'Salvar configurações') + '</button>' +
      '<button type="button" onclick="seerTourStart()" class="px-5 py-2.5 rounded-full text-sm font-bold bg-white/[0.08] hover:bg-white/[0.14] text-white">Ver o passeio de novo</button>' +
      '<span class="text-[11px] text-[#7a7a85]">As chaves ficam criptografadas no banco (AES-GCM); a chave de criptografia fica em seer.key, na pasta de dados. As do .env são copiadas para cá na primeira inicialização.</span></div>';
    return out + '</div>';
  }

  function styleNavCfg(active) {
    var b = $('nav-cfg');
    if (!b) return;
    b.className = 'nav-btn group flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-all ' +
      (active ? 'font-bold bg-white/[0.1] text-white' : 'font-semibold text-[#a7a7b0] hover:text-white hover:bg-white/[0.05]');
    var ic = b.querySelector('.nav-icon');
    if (ic) ic.classList.toggle('text-[#3b8cff]', active);
  }

  // ---------------------------------------------------------------- tour ---
  // Passeio do primeiro login: destaca cada função. O "já visto" fica no servidor, por usuário
  // (/api/seer/state, chave tour), então não volta em outro navegador nem na UI clássica.
  var TOUR = [
    { lang: true, t: 'Bem-vindo ao Guitarr', d: 'Sua biblioteca e tudo que ainda falta nela, num lugar só. Vou mostrar as funções rapidinho.' },
    { sel: '#global-search-input', t: 'Buscar ou pedir', d: 'Procure no que você já tem e no catálogo do MusicBrainz. O que não estiver na biblioteca você pede com um clique.' },
    { sel: '#nav-songs', t: 'Sua biblioteca', d: 'Músicas, álbuns e artistas. Duplo clique toca; o menu ⋮ de cada faixa edita as tags.' },
    { sel: '#nav-seer', t: 'Pedidos', d: 'Acompanhe cada pedido: pendente, na fila, baixando, disponível ou falhou. Nos que falharam, tente de novo.' },
    { sel: 'button[onclick="openImportPlaylistModal()"]', t: 'Importar playlist', d: 'Traga playlists e favoritos do Spotify ou do YouTube Music por link ou CSV (Exportify). As músicas que faltam viram pedidos.' },
    { sel: '#nav-podcasts', t: 'Podcasts', d: 'Assine podcasts do YouTube ou RSS e escolha quantos episódios manter.' },
    { sel: '#nav-radios', t: 'Rádios & Shares', d: 'Rádios da internet e os links que você compartilhou.' },
    { sel: 'button[onclick="openStorageModal()"]', t: 'Armazenamento', d: 'Quanto a música ocupa e o limite. Ao chegar no limite, os downloads param. As duplicatas também ficam aqui.' },
    { sel: '#nav-meta', admin: true, t: 'Organizar Metadados', d: 'Álbuns e artistas repetidos, faixas sem tags e álbuns sem capa, com o conserto a um clique.' },
    { sel: '#nav-cfg', admin: true, t: 'Configurações', d: 'Aprovação automática dos pedidos e as fontes de download, sem reiniciar o servidor.' },
    { t: 'Pronto!', d: 'Bom proveito. Admins podem rever este passeio em Configurações.' },
  ];
  var tour = { steps: [], i: 0 };

  function tourVisible(sel) {
    var el = sel && document.querySelector(sel);
    if (!el) return null;
    var r = el.getBoundingClientRect();
    return (r.width && r.height) ? el : null;
  }
  function tourClose(done) {
    var o = $('seer-tour'); if (o) o.remove();
    window.removeEventListener('resize', tourDraw);
    document.removeEventListener('keydown', tourKey);
    if (done) api('/api/seer/state', { method: 'PUT', json: { tour: { done: true } } }).catch(function () {});
  }
  function tourKey(e) { if (e.key === 'Escape') tourClose(true); }
  function tourDraw() {
    var s = tour.steps[tour.i];
    if (!s) return tourClose(true);
    var el = tourVisible(s.sel);
    var o = $('seer-tour');
    if (!o) {
      o = document.createElement('div');
      o.id = 'seer-tour';
      document.body.appendChild(o);
    }
    var spot = '', card;
    var last = tour.i === tour.steps.length - 1;
    if (el) {
      el.scrollIntoView({ block: 'nearest' });
      var r = el.getBoundingClientRect();
      spot = '<div style="position:fixed;z-index:9998;pointer-events:none;border-radius:14px;transition:all .25s ease;' +
        'top:' + (r.top - 6) + 'px;left:' + (r.left - 6) + 'px;width:' + (r.width + 12) + 'px;height:' + (r.height + 12) + 'px;' +
        'box-shadow:0 0 0 9999px rgba(0,0,0,.72),0 0 0 2px #3b8cff"></div>';
      var below = r.bottom + 230 < window.innerHeight;
      var left = Math.min(Math.max(r.left, 16), window.innerWidth - 376);
      card = 'top:' + (below ? r.bottom + 16 : Math.max(16, r.top - 216)) + 'px;left:' + left + 'px;';
    } else {
      spot = '<div style="position:fixed;inset:0;z-index:9998;background:rgba(0,0,0,.72)"></div>';
      card = 'top:50%;left:50%;transform:translate(-50%,-50%);';
    }
    o.innerHTML = spot +
      '<div role="dialog" aria-label="' + esc(s.t) + '" style="position:fixed;z-index:9999;width:min(360px,calc(100vw - 32px));' + card + '" ' +
      'class="bg-[#18181f] border border-white/10 rounded-2xl p-5 shadow-2xl">' +
      '<div class="text-[10px] font-bold tracking-widest text-[#7a7a85] uppercase">Passo ' + (tour.i + 1) + ' de ' + tour.steps.length + '</div>' +
      '<div class="font-display font-black text-lg text-white mt-1">' + esc(s.t) + '</div>' +
      '<p class="text-sm text-[#a7a7b0] mt-1.5">' + esc(s.d) + '</p>' +
      (s.lang ? '<div class="mt-3"><div class="text-[11px] font-bold text-[#a7a7b0] mb-1.5">Idioma</div><div class="flex gap-1">' + window.seerLangChips() + '</div></div>' : '') +
      '<div class="flex items-center gap-2 mt-4">' +
      '<button type="button" onclick="seerTourSkip()" class="text-xs font-bold text-[#a7a7b0] hover:text-white">Pular</button>' +
      '<span class="flex-1"></span>' +
      (tour.i > 0 ? '<button type="button" onclick="seerTourGo(-1)" class="px-4 py-2 rounded-full text-xs font-bold bg-white/[0.08] hover:bg-white/[0.14] text-white">Voltar</button>' : '') +
      '<button type="button" onclick="seerTourGo(1)" class="px-4 py-2 rounded-full text-xs font-extrabold bg-[#3b8cff] hover:bg-[#5aa0ff] text-black">' +
      (last ? 'Concluir' : 'Próximo') + '</button></div></div>';
  }
  window.seerTourGo = function (d) {
    tour.i += d;
    if (tour.i >= tour.steps.length) return tourClose(true);
    tourDraw();
  };
  window.seerTourSkip = function () { tourClose(true); };
  window.seerTourStart = function () {
    tour.steps = TOUR.filter(function (s) { return !s.admin || (auth && auth.isAdmin); });
    tour.i = 0;
    window.addEventListener('resize', tourDraw);
    document.addEventListener('keydown', tourKey);
    tourDraw();
  };
  async function maybeStartTour() {
    try {
      var st = await apiJson('/api/seer/state');
      if (!(st && st.tour && st.tour.done)) window.seerTourStart();
    } catch (e) {}
  }

  // mock nunca aparece: zera tudo que não vem do servidor
  TRACKS.length = 0; ALBUMS.length = 0; ARTISTS.length = 0; PLAYLISTS.length = 0;
  SEER_REQUESTS.length = 0; SEER_CATALOG_SUGGESTIONS.length = 0; PODCASTS.length = 0;
  state.currentTrackIndex = 0; state.currentTimeSec = 0; state.isPlaying = false; state.synthEnabled = false;

  window.onload = function () {
    loadAuth();
    applyHashRoute();
    renderSidebarPlaylists();
    renderCurrentView();
    initVisualizer();
    if (auth) boot(); else showLogin('');
  };
})();
