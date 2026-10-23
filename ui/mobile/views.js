'use strict';
(function () {
  var S = window.S, $ = S.$, esc = S.esc, I = S.I;
  var lists = {}, listSeq = 0, scrollMem = {}, curViewKey = '';
  var STATUS_LABEL = { pending: 'Aguardando aprovação', queued: 'Na fila', searching: 'Buscando', downloading: 'Baixando',
    importing: 'Importando', available: 'Disponível', failed: 'Falhou' };
  var STATUS_PCT = { pending: 6, queued: 12, searching: 32, downloading: 62, importing: 90, available: 100, failed: 100 };
  function isActive(s) { return s === 'pending' || s === 'queued' || s === 'searching' || s === 'downloading' || s === 'importing'; }
  var TABS = ['home', 'seer', 'library', 'podcasts', 'car'];

  function reg(tracks) { var k = 'l' + (++listSeq); lists[k] = tracks; return k; }
  function art(url, cls, extra) {
    return '<span class="art ' + (cls || 'r12 a44') + '"' + (extra || '') + '>' + (url ? '<img src="' + esc(url) + '" alt="" loading="lazy" onerror="this.remove()">' : '') + '</span>';
  }
  function trackCover(t, size) {
    if (t.cover) return t.cover;
    return S.coverUrl(t.albumId || ('mf-' + t.id), size || 120);
  }
  function empty(msg) { return '<div class="empty">' + esc(msg) + '</div>'; }

  // ------------------------------------------------------------ linha de faixa ---
  function songRow(t, key, i, opt) {
    opt = opt || {};
    var cur = S.cur() && S.cur().id === t.id;
    var q = t.kind === 'song' ? S.quality(t) : '';
    return '<div class="song' + (cur ? ' cur' : '') + '" data-act="play" data-list="' + key + '" data-i="' + i + '" data-id="' + esc(t.id) + '" role="button">' +
      '<span class="art r12 a44">' + '<img src="' + esc(trackCover(t, 120)) + '" alt="" loading="lazy" onerror="this.remove()">' +
      '<span class="eq"><i></i><i></i><i></i></span></span>' +
      '<span class="grow"><div class="t trunc">' + esc(opt.num ? (t.track ? t.track + '. ' : '') + t.title : t.title) + '</div>' +
      '<div class="s">' + (S.offlineHas(t.id) ? '<span class="off-dot">↓</span>' : '') + (q ? '<span class="pill">' + esc(q) + '</span>' : '') +
      '<span class="trunc">' + esc(opt.noArtist ? S.fmtDur(t.duration) : t.artist) + '</span></div></span>' +
      '<button class="more" data-act="trackmenu" data-list="' + key + '" data-i="' + i + '" aria-label="Opções">' + I.more + '</button></div>';
  }
  function songRows(tracks, opt) {
    var key = reg(tracks);
    return tracks.map(function (t, i) { return songRow(t, key, i, opt); }).join('');
  }

  // -------------------------------------------------------------------- home ---
  S.visibleSongs = function () { return homeTracks(); };
  function homeTracks() {
    var q = S.homeQ.trim().toLowerCase();
    var list = S.tracks.filter(function (t) {
      if (S.filter === 'fav' && !S.isFav(t)) return false;
      if (S.filter === 'flac' && !t.lossless) return false;
      if (S.filter === 'offline' && !S.offlineHas(t.id)) return false;
      if (q && (t.title + ' ' + t.artist + ' ' + t.album).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    return S.sortSongs ? S.sortSongs(list) : list;
  }
  function homeListHtml() {
    var all = homeTracks();
    if (!all.length) return empty(S.tracks.length ? 'Nada por aqui com esse filtro.' : (S.loaded ? 'Biblioteca vazia. Peça músicas na aba Pedidos.' : 'Carregando…'));
    var shown = all.slice(0, S.homeLimit);
    var key = reg(all); // o índice vale para a lista inteira: tocar continua pelas próximas
    return shown.map(function (t, i) { return songRow(t, key, i); }).join('') +
      (all.length > shown.length ? '<div style="text-align:center;padding:10px"><button class="btn" data-act="more">Mostrar mais (' + (all.length - shown.length) + ')</button></div>' : '');
  }
  function greeting() {
    var h = new Date().getHours(), g = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
    var n = S.auth && (S.auth.name || S.auth.username) || '';
    return g + (n ? ', ' + n.charAt(0).toUpperCase() + n.slice(1) : '');
  }
  function homeHtml() {
    var recent = S.albums.slice().sort(function (a, b) { return String(b.createdAt || '').localeCompare(String(a.createdAt || '')); }).slice(0, 4);
    var host = S.base() ? S.base().replace(/^https?:\/\//, '') : location.host;
    var n = S.auth.name || S.auth.username || '?';
    return '<div class="screen stack">' +
      (!S.online ? '<div class="banner">Sem conexão · mostrando só o que está salvo offline</div>' : '') +
      '<div class="row between"><div class="row"><span class="art circle a40" style="background:linear-gradient(135deg,#3b8cff,#047857);color:#000;font-weight:900;display:flex;align-items:center;justify-content:center">' + esc(n.charAt(0).toUpperCase()) + '</span>' +
      '<div><div class="h2">' + esc(greeting()) + '</div><div class="xs" style="color:var(--green);font-weight:700">● ' + esc(host) + ' · ' + S.tracks.length + ' músicas</div></div></div>' +
      '<button class="icon-btn" data-act="tab" data-tab="seer" aria-label="Pedir música">' + I.plus + '</button></div>' +
      '<div class="searchbox">' + I.search + '<input id="home-q" class="input" type="search" placeholder="Buscar na biblioteca" value="' + esc(S.homeQ) + '" autocomplete="off"></div>' +
      '<div class="chips">' + [['all', 'Todas (' + S.tracks.length + ')'], ['fav', '♥ Curtidas'], ['flac', 'FLAC Lossless'], ['offline', '↓ Offline']]
        .map(function (c) { return '<button class="chip' + (S.filter === c[0] ? ' on' : '') + '" data-act="filter" data-f="' + c[0] + '">' + esc(c[1]) + '</button>'; }).join('') + '</div>' +
      (recent.length && !S.homeQ ? '<div class="grid2">' + recent.map(function (a) {
        return '<button class="tile" data-act="album" data-id="' + esc(a.id) + '">' + art(S.coverUrl(a.id, 120), 'a52') +
          '<span class="grow"><div class="small trunc" style="font-weight:800">' + esc(a.name) + '</div><div class="xs muted trunc">' + esc(a.artist) + '</div></span></button>';
      }).join('') + '</div>' : '') +
      (S.mixesHtml ? S.mixesHtml() : '') +
      '<div><div class="row between mb8"><div><div class="h2">Músicas na Biblioteca</div><div class="xs muted">Toque para ouvir · ⋮ para opções</div></div>' +
      '<button class="btn green" data-act="shuffleall">' + I.play + ' Shuffle</button></div>' +
      (S.sortControl ? '<div class="mb8">' + S.sortControl() + '</div>' : '') +
      '<div id="home-list">' + homeListHtml() + '</div></div></div>';
  }

  // ------------------------------------------------------------- biblioteca ---
  function albumTile(a) {
    return '<button class="album" data-act="album" data-id="' + esc(a.id) + '">' + art(S.coverUrl(a.id, 300), 'r16') +
      '<div class="t trunc">' + esc(a.name) + '</div><div class="s trunc">' + esc(a.artist) + (a.year ? ' · ' + a.year : '') + '</div></button>';
  }
  function playlistsAll() {
    return [{ id: '__fav', name: 'Músicas Curtidas', count: S.tracks.filter(S.isFav).length, virtual: true }]
      .concat(S.playlists.map(function (p) { return { id: p.id, name: p.name, count: p.songCount || 0 }; }));
  }
  function libraryHtml() {
    var seg = ['albums:Álbuns', 'artists:Artistas', 'playlists:Playlists', 'offline:Offline'].map(function (x) {
      var p = x.split(':'); return '<button class="' + (S.libSeg === p[0] ? 'on' : '') + '" data-act="libseg" data-s="' + p[0] + '">' + p[1] + '</button>';
    }).join('');
    var body = '';
    if (S.libSeg === 'albums') {
      body = S.albums.length ? '<div class="grid2">' + S.albums.slice(0, 200).map(albumTile).join('') + '</div>' : empty('Nenhum álbum ainda.');
    } else if (S.libSeg === 'artists') {
      body = S.artists.length ? S.artists.map(function (a) {
        return '<button class="song" data-act="artist" data-id="' + esc(a.id) + '">' + art(S.coverUrl('ar-' + a.id, 120), 'circle a44') +
          '<span class="grow"><div class="t trunc">' + esc(a.name) + '</div><div class="s">' + a.albumCount + ' álbuns · ' + a.songCount + ' faixas</div></span></button>';
      }).join('') : empty('Nenhum artista ainda.');
    } else if (S.libSeg === 'playlists') {
      body = playlistsAll().map(function (p) {
        return '<button class="song" data-act="playlist" data-id="' + esc(p.id) + '">' +
          (p.virtual ? '<span class="art r12 a44" style="background:linear-gradient(135deg,#4b2bd6,#3b8cff);display:flex;align-items:center;justify-content:center;color:#fff">♥</span>'
            : art(S.coverUrl('pl-' + p.id, 120), 'r12 a44')) +
          '<span class="grow"><div class="t trunc">' + esc(p.name) + '</div><div class="s">Playlist · ' + p.count + ' músicas</div></span></button>';
      }).join('');
    } else {
      body = S.offlineScreen();
    }
    return '<div class="screen stack"><div><div class="eyebrow">Sua coleção</div><h1 class="h1">Biblioteca</h1></div><div class="seg">' + seg + '</div><div>' + body + '</div></div>';
  }

  // ------------------------------------------------------------------ páginas ---
  function backBtn(label) { return '<button class="back" data-act="back">' + I.back + esc(label || 'Voltar') + '</button>'; }
  function albumTracks(id) {
    return S.tracks.filter(function (t) { return t.albumId === id; })
      .sort(function (a, b) { return (a.disc - b.disc) || (a.track - b.track) || (a.title < b.title ? -1 : 1); });
  }
  function actionButtons(key) {
    return '<div class="row gap8 mt12"><button class="btn green" data-act="playall" data-list="' + key + '">' + I.play + ' Tocar</button>' +
      '<button class="btn" data-act="playall" data-list="' + key + '" data-shuffle="1">' + I.shuffle + ' Aleatório</button></div>';
  }
  function albumPage(p) {
    var a = S.albums.find(function (x) { return x.id === p.id; });
    var tr = albumTracks(p.id);
    if (!a && !tr.length) return backBtn() + empty('Álbum não encontrado.');
    a = a || { name: tr[0].album, artist: tr[0].artist };
    var key = reg(tr);
    return '<div class="screen">' + backBtn() + '<div class="hero">' + art(S.coverUrl(p.id, 400), 'r16') +
      '<div class="grow"><div class="eyebrow">Álbum</div><h1 class="h1">' + esc(a.name) + '</h1>' +
      '<div class="small muted">' + esc(a.artist) + (a.year ? ' · ' + a.year : '') + ' · ' + tr.length + ' faixas</div></div></div>' +
      actionButtons(key) + '<div class="row gap8 mt8">' + S.offlineButton('album', p.id) + '</div><div class="mt16">' + tr.map(function (t, i) { return songRow(t, key, i, { num: true, noArtist: true }); }).join('') + '</div></div>';
  }
  function artistPage(p) {
    var ar = S.artists.find(function (x) { return x.id === p.id; });
    var albums = S.albums.filter(function (a) { return a.artistId === p.id; });
    var tr = S.tracks.filter(function (t) { return t.artistId === p.id; });
    var key = reg(tr);
    return '<div class="screen">' + backBtn() + '<div class="row gap16">' + art(S.coverUrl('ar-' + p.id, 200), 'circle', ' style="width:96px;height:96px"') +
      '<div><div class="eyebrow">Artista</div><h1 class="h1">' + esc(ar ? ar.name : '—') + '</h1><div class="small muted">' + albums.length + ' álbuns · ' + tr.length + ' faixas</div></div></div>' +
      actionButtons(key) +
      (S.discoHtml && ar ? S.discoHtml(ar, albums) : albums.length ? '<div class="h2 mt16 mb8">Álbuns</div><div class="grid2">' + albums.map(albumTile).join('') + '</div>' : '') +
      '<div class="h2 mt16 mb8">Músicas</div>' + tr.slice(0, 100).map(function (t, i) { return songRow(t, key, i); }).join('') + '</div>';
  }
  function playlistPage(p) {
    var name, tr;
    if (p.id === '__fav') { name = 'Músicas Curtidas'; tr = S.tracks.filter(S.isFav); }
    else {
      var pl = S.playlists.find(function (x) { return x.id === p.id; });
      name = pl ? pl.name : 'Playlist';
      tr = (S.plTracks && S.plTracks[p.id]) || null;
      if (!tr) { loadPlaylist(p.id); return '<div class="screen">' + backBtn() + '<h1 class="h1">' + esc(name) + '</h1><div class="empty pulse">Carregando…</div></div>'; }
    }
    var key = reg(tr);
    return '<div class="screen">' + backBtn() + '<div class="eyebrow">Playlist</div><h1 class="h1">' + esc(name) + '</h1><div class="small muted">' + tr.length + ' músicas</div>' +
      (tr.length ? actionButtons(key) + '<div class="row gap8 mt8">' + S.offlineButton('playlist', p.id) + '</div>' : '') + '<div class="mt16">' + (tr.length ? tr.map(function (t, i) { return songRow(t, key, i); }).join('') : empty('Playlist vazia.')) + '</div></div>';
  }
  async function loadPlaylist(id) {
    try {
      var d = await S.subsonic('getPlaylist', { id: id });
      var entries = (d.playlist && d.playlist.entry) || [];
      S.plTracks = S.plTracks || {};
      S.plTracks[id] = entries.map(function (e) { return S.byId[e.id] || S.mkTrack(e); });
    } catch (e) { S.plTracks = S.plTracks || {}; S.plTracks[id] = []; S.toast('Erro ao abrir a playlist: ' + S.errMsg(e)); }
    var top = S.pages[S.pages.length - 1];
    if (top && top.type === 'playlist' && top.id === id) S.render();
  }

  // ---------------------------------------------------------------- pedidos ---
  function reqFor(item) { return S.seer.requests.find(function (r) { return r.mbid === item.mbid; }); }
  function caa(id, size) { return id ? 'https://coverartarchive.org/release-group/' + encodeURIComponent(id) + '/front-' + (size || 250) : ''; }
  function seerQueueHtml() {
    var rs = S.seer.requests.slice().sort(function (a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); });
    var active = rs.filter(function (r) { return isActive(r.status); });
    var recent = rs.filter(function (r) { return !isActive(r.status); }).slice(0, 4);
    if (!active.length && !recent.length) return '';
    var failed = rs.filter(function (r) { return r.status === 'failed'; });
    function card(r) {
      var pct = STATUS_PCT[r.status] || 0;
      var pill = r.status === 'failed' ? 'r' : r.status === 'available' ? 'g' : 'a';
      return '<div class="card row">' + art(caa(r.coverId, 250), 'r12 a44') + '<div class="grow"><div class="row between"><span class="small trunc" style="font-weight:800">' + esc(r.title || r.album) + '</span>' +
        '<span class="pill ' + pill + (isActive(r.status) ? ' pulse' : '') + '">' + esc(STATUS_LABEL[r.status] || r.status) + '</span></div>' +
        '<div class="xs muted trunc">' + esc(r.artist) + (r.source ? ' · ' + esc(r.source) : '') + (r.error ? ' · ' + esc(r.error) : '') + '</div>' +
        (isActive(r.status) ? '<div class="bar mt8"><i style="width:' + pct + '%"></i></div>' : '') + '</div>' +
        (r.status === 'failed' && S.auth.isAdmin ? '<button class="btn sm" data-act="retry" data-id="' + esc(r.id) + '">Tentar</button>' : '') + '</div>';
    }
    var done = rs.filter(function (r) { return r.status === 'available' || r.status === 'failed'; }).length;
    return '<div><div class="row between mb8"><div class="h2">Pedidos no servidor</div><div class="row gap8">' +
      (failed.length && S.auth.isAdmin ? '<button class="btn sm" data-act="retryall">Tentar de novo (' + failed.length + ')</button>' : '') +
      (done ? '<button class="btn sm" data-act="clearreqs">Limpar (' + done + ')</button>' : '') + '</div></div><div class="col gap8">' +
      active.concat(recent).map(card).join('') + '</div></div>';
  }
  function seerResultsHtml() {
    var s = S.seer;
    if (s.detail) return seerDetailHtml();
    if (!s.q.trim()) return '<div class="empty">Busque um artista, álbum ou música. Cole também um link de playlist do Spotify ou YouTube Music abaixo.</div>';
    if (s.loading) return '<div class="empty pulse">Buscando no MusicBrainz…</div>';
    if (s.error) return '<div class="empty" style="color:var(--red)">' + esc(s.error) + '</div>';
    if (!s.results.length) return empty('Nada encontrado.');
    return '<div class="col gap8">' + s.results.map(function (it, i) { return seerItemHtml(it, i, 'r'); }).join('') + '</div>';
  }
  function seerItemHtml(it, i, src) {
    var rq = reqFor(it), kind = it.kind === 'artist' ? 'Artista' : it.kind === 'album' ? (it.type || 'Álbum') : 'Música';
    var btn;
    if (it.inLibrary) btn = '<button class="btn sm" data-act="seeropen" data-src="' + src + '" data-i="' + i + '">Na biblioteca ✓</button>';
    else if (rq) btn = '<span class="pill ' + (rq.status === 'failed' ? 'r' : 'g') + (isActive(rq.status) ? ' pulse' : '') + '">' + esc(STATUS_LABEL[rq.status] || rq.status) + '</span>';
    else if (it.kind === 'artist') btn = '<button class="btn sm" data-act="seerdetail" data-src="' + src + '" data-i="' + i + '">Ver álbuns</button>';
    else btn = '<button class="btn green sm" data-act="seerreq" data-src="' + src + '" data-i="' + i + '">+ Pedir</button>';
    var sub = [it.kind === 'artist' ? '' : it.artist, it.year || '', kind].filter(Boolean).join(' · ');
    var open = (it.kind === 'artist' || it.kind === 'album') && !it.inLibrary ? ' data-act="seerdetail" data-src="' + src + '" data-i="' + i + '"' : '';
    return '<div class="card row"' + open + ' style="padding:10px">' +
      (it.kind === 'artist' ? '<span class="art circle a44" style="display:flex;align-items:center;justify-content:center">♪</span>' : art(caa(it.coverId || it.mbid, 250), 'r12 a44')) +
      '<div class="grow"><div class="small trunc" style="font-weight:800">' + esc(it.title || it.album || it.artist) + '</div><div class="xs muted trunc">' + esc(sub) + '</div></div>' + btn + '</div>';
  }
  function seerDetailHtml() {
    var d = S.seer.detail;
    var items = d.items || [];
    return '<div><button class="back" data-act="seerback">' + I.back + 'Resultados</button>' +
      '<div class="h1" style="font-size:19px">' + esc((d.head && (d.head.title || d.head.name)) || '') + '</div>' +
      '<div class="xs muted mb8">' + esc(d.kind === 'artist' ? 'Discografia' : (d.head && d.head.artist) || '') + '</div>' +
      (d.kind === 'album' && d.head ? '<button class="btn green mb8" data-act="seerreq" data-src="h" data-i="0">+ Pedir álbum completo</button>' : '') +
      '<div class="col gap8">' + items.map(function (it, i) {
        if (d.kind === 'album') {
          return '<div class="card row" style="padding:10px"><span class="art r12 a40" style="display:flex;align-items:center;justify-content:center;font-weight:800">' + (it.trackNumber || i + 1) + '</span>' +
            '<div class="grow"><div class="small trunc" style="font-weight:800">' + esc(it.title) + '</div><div class="xs muted">' + esc(S.fmtDur((it.durationMs || 0) / 1000)) + '</div></div>' +
            (it.inLibrary ? '<span class="pill g">Na biblioteca</span>' : '<button class="btn green sm" data-act="seerreq" data-src="d" data-i="' + i + '">+ Pedir</button>') + '</div>';
        }
        return seerItemHtml(it, i, 'd');
      }).join('') + '</div></div>';
  }
  function seerHtml() {
    return '<div class="screen stack"><div><div class="eyebrow">Catálogo MusicBrainz + Soulseek/YouTube</div><h1 class="h1">Buscar & Pedir</h1></div>' +
      '<div class="searchbox">' + I.search + '<input id="seer-q" class="input" type="search" placeholder="Artista, álbum ou música" value="' + esc(S.seer.q) + '" autocomplete="off"></div>' +
      '<div id="seer-queue">' + seerQueueHtml() + '</div><div id="seer-results">' + seerResultsHtml() + '</div>' +
      '<div class="card" style="background:linear-gradient(90deg,rgba(59,140,255,.16),rgba(192,132,252,.16))"><div class="h2">Importar playlists e favoritos</div>' +
      '<div class="xs muted mb8">Cole o link (Spotify / YouTube Music) ou envie o CSV do Exportify. As faixas que faltam viram pedidos.</div>' +
      '<div class="chips mb8">' + [['playlist', 'Playlist'], ['favorites', '♥ Favoritos'], ['both', 'Os dois']].map(function (c) {
        return '<button class="chip' + ((S.seer.impTarget || 'playlist') === c[0] ? ' on' : '') + '" data-act="imptarget" data-v="' + c[0] + '">' + esc(c[1]) + '</button>';
      }).join('') + '</div>' +
      '<div class="row gap8"><input id="imp-url" class="input plain" type="url" placeholder="https://open.spotify.com/playlist/…"><button class="btn white" data-act="import">Importar</button></div>' +
      '<label class="btn" style="display:block;text-align:center;margin-top:8px;background:rgba(255,255,255,.08)">Enviar CSV / ZIP (Exportify)' +
      '<input id="imp-file" type="file" multiple accept=".csv,.json,.txt,.zip,text/csv,application/json,text/plain,application/zip" style="display:none"></label></div></div>';
  }

  // ----------------------------------------------------------------- podcasts ---
  function keepLabel(n) { return n === -1 ? 'Apenas manual' : n === 1 ? 'Manter o último' : n === 3 ? 'Manter os 3 últimos' : 'Manter todos'; }
  function podFollowing(r) {
    return S.pod.channels.some(function (c) { return (r.feedUrl && (c.feedUrl === r.feedUrl || c.url === r.feedUrl)) || (r.url && c.url === r.url); });
  }
  function podResultsHtml() {
    var p = S.pod;
    if (!p.q.trim()) return '';
    if (p.searching) return '<div class="empty pulse">Buscando podcasts…</div>';
    if (p.serr) return '<div class="empty" style="color:var(--red)">' + esc(p.serr) + '</div>';
    if (!p.results.length) return empty('Nenhum podcast encontrado.');
    return '<div class="col gap8">' + p.results.map(function (r, i) {
      var key = r.feedUrl || r.url, btn;
      if (podFollowing(r)) btn = '<span class="pill g">Seguindo ✓</span>';
      else if (p.adding[key]) btn = '<span class="pill g pulse">Adicionando…</span>';
      else btn = '<button class="btn green sm" data-act="podfollow" data-i="' + i + '">+ Seguir</button>';
      return '<div class="card row" style="padding:10px">' +
        (r.imageUrl ? art(r.imageUrl, 'r12', ' style="width:52px;height:52px"') : '<span class="art r12" style="width:52px;height:52px;display:flex;align-items:center;justify-content:center;font-size:22px">🎙</span>') +
        '<div class="grow" style="min-width:0"><div class="small trunc" style="font-weight:800">' + esc(r.title) + '</div>' +
        '<div class="xs muted trunc">' + esc(r.author || '') + '</div>' +
        '<div class="xs" style="margin-top:3px"><span class="pill ' + (r.sourceType === 'youtube' ? 'r' : 'p') + '">' + (r.sourceType === 'youtube' ? 'YouTube' : 'RSS') + '</span></div></div>' + btn + '</div>';
    }).join('') + '</div>';
  }
  function podcastsHtml() {
    var p = S.pod;
    return '<div class="screen stack"><div class="row between"><div><div class="eyebrow" style="color:var(--purple)">YouTube + RSS</div><h1 class="h1">Podcasts</h1></div>' +
      '<div class="row gap8"><button class="icon-btn" data-act="podrefresh" aria-label="Verificar todos">↻</button><button class="icon-btn" data-act="podadd" aria-label="Adicionar canal">' + I.plus + '</button></div></div>' +
      '<div class="searchbox">' + I.search + '<input id="pod-q" class="input" type="search" placeholder="Buscar podcasts" value="' + esc(p.q) + '" autocomplete="off"></div>' +
      '<div class="chips">' + [['all', 'Todos'], ['rss', 'Apple Podcasts'], ['youtube', 'YouTube']].map(function (x) {
        return '<button class="chip' + (p.src === x[0] ? ' on' : '') + '" data-act="podsrc" data-v="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>' +
      '<div id="pod-results">' + podResultsHtml() + '</div>' +
      (p.error ? '<div class="empty" style="color:var(--red)">' + esc(p.error) + '</div>' : '') +
      (p.loading ? '<div class="empty pulse">Carregando…</div>' : '') +
      (!p.channels.length && !p.loading && !p.error && !p.q.trim() ? empty('Nenhum canal ainda. Busque um podcast acima ou toque em + para colar um feed RSS ou canal do YouTube.') : '') +
      '<div class="col gap8">' + p.channels.map(function (c) {
        return '<button class="card row" data-act="podcast" data-id="' + esc(c.id) + '" style="text-align:left;width:100%">' +
          (c.imageUrl ? art(c.imageUrl, 'r12', ' style="width:60px;height:60px"') : '<span class="art r12" style="width:60px;height:60px;display:flex;align-items:center;justify-content:center;font-size:24px">🎙</span>') +
          '<span class="grow"><div class="small" style="font-weight:800">' + esc(c.title) + '</div><div class="xs muted trunc">' + esc(c.author || '') + '</div>' +
          '<div class="xs" style="color:var(--purple);margin-top:3px">' + (c.downloadedCount || 0) + '/' + (c.episodeCount || 0) + ' baixados · ' + esc(keepLabel(c.keepPolicy)) + '</div></span></button>';
      }).join('') + '</div></div>';
  }
  function episodeTrack(c, ep) {
    return { id: ep.id, kind: 'episode', title: ep.title, artist: c ? c.title : 'Podcast', album: c ? c.title : '', duration: ep.duration || 0,
      cover: c && c.imageUrl || '', suffix: '', albumId: '', artistId: '' };
  }
  // Escolha de retenção em folha (sheet). cb recebe o valor escolhido.
  var KEEP_CHOICES = [[-1, 'Apenas manual', 'Você escolhe os episódios um a um.'], [1, 'Manter apenas o último', 'Baixa o mais novo e apaga o anterior.'],
    [3, 'Manter os 3 últimos', 'Mantém no máximo os 3 mais recentes.'], [0, 'Manter todos', 'Baixa todos os episódios e guarda o histórico.']];
  function pickRetention(title, current, cb) {
    S.keepCb = cb;
    openSheet('<div class="h2 mb8">' + esc(title) + '</div><div class="col gap8">' + KEEP_CHOICES.map(function (o) {
      return '<button class="card row' + (o[0] === current ? ' on' : '') + '" style="text-align:left;width:100%" data-act="keepset" data-v="' + o[0] + '">' +
        '<div class="grow"><div class="small" style="font-weight:800">' + o[1] + '</div><div class="xs muted">' + o[2] + '</div></div></button>';
    }).join('') + '</div><button class="btn" style="width:100%;margin-top:8px" data-act="sheet-close-btn">Cancelar</button>');
  }
  // Adicionar canal: só grava depois de escolher a retenção.
  function addWithRetention(title, body) {
    pickRetention('Retenção para "' + title + '"', null, async function (v) {
      try {
        await S.apiJson('/api/seer/podcasts', { method: 'POST', json: Object.assign({}, body, { keepPolicy: v }) });
        S.toast('Canal adicionado: ' + title);
      } catch (e) { S.toast('Erro ao adicionar: ' + S.errMsg(e)); }
      await podLoad();
      var el = $('pod-results'); if (el) el.innerHTML = podResultsHtml();
    });
  }
  // Mudar retenção: pergunta antes de apagar downloads que saem do novo modo.
  function changeRetention(c, v) {
    S.apiJson('/api/seer/podcasts/' + encodeURIComponent(c.id) + '/prune-preview?keepPolicy=' + v).then(async function (plan) {
      plan = plan || [];
      var prune = plan.length > 0 && confirm(plan.length + ' episódio(s) baixado(s) não entram em "' + keepLabel(v) + '" e serão apagados.\n\nOK: apagar agora. Cancelar: só mudar a retenção.');
      await S.api('/api/seer/podcasts/' + encodeURIComponent(c.id), { method: 'PUT', json: { keepPolicy: v, autoDownload: v !== -1, prune: prune } });
      c.keepPolicy = v; S.toast('Retenção: ' + keepLabel(v) + (prune ? ' · ' + plan.length + ' apagado(s)' : ''));
      await podLoad(); S.render();
    }).catch(function (e) { S.toast('Erro: ' + S.errMsg(e)); });
  }
  function podcastPage(p) {
    var c = S.pod.channels.find(function (x) { return x.id === p.id; });
    var eps = S.pod.episodes[p.id];
    var playable = (eps || []).filter(function (e) { return e.status === 'downloaded'; }).map(function (e) { return episodeTrack(c, e); });
    var key = reg(playable);
    var more = !!(S.pod.more && S.pod.more[p.id]);
    var byDate = function (x, y) { return String(y.publishedAt || '').localeCompare(String(x.publishedAt || '')); };
    var have = (eps || []).filter(function (e) { return e.status === 'downloaded'; }).sort(byDate);
    var rest = (eps || []).filter(function (e) { return e.status !== 'downloaded'; }).sort(byDate);
    function epRow(ep) {
      var ok = ep.status === 'downloaded', when = ep.publishedAt ? new Date(ep.publishedAt).toLocaleDateString(window.seerLocale ? window.seerLocale() : 'pt-BR') : '';
      var pi = playable.findIndex(function (t) { return t.id === ep.id; });
      return '<div class="card row" style="padding:10px"><div class="grow"><div class="small" style="font-weight:800">' + esc(ep.title) + '</div>' +
        '<div class="xs muted">' + esc(when) + (ep.duration ? ' · ' + S.fmtDur(ep.duration) : '') + ' · ' + esc(ep.status) + '</div></div>' +
        (ok ? '<button class="icon-btn" style="background:var(--green);color:#000" data-act="play" data-list="' + key + '" data-i="' + pi + '" aria-label="Tocar">' + I.play + '</button>'
          : '<button class="btn sm" data-act="epdl" data-ch="' + esc(p.id) + '" data-id="' + esc(ep.id) + '">Baixar</button>') + '</div>';
    }
    var body = eps == null ? '<div class="empty pulse">Carregando episódios…</div>' : !eps.length ? empty('Sem episódios.') :
      '<div class="col gap8">' + have.map(epRow).join('') +
      (rest.length ? '<button class="btn" data-act="podmore" data-id="' + esc(p.id) + '">' + (more ? 'Ocultar os demais' : 'Ver os demais (' + rest.length + ')') + '</button>' : '') +
      (more ? rest.map(epRow).join('') : '') + '</div>';
    return '<div class="screen">' + backBtn('Podcasts') + '<div class="row gap16 mb8">' + (c && c.imageUrl ? art(c.imageUrl, 'r16', ' style="width:88px;height:88px"') : '') +
      '<div><h1 class="h1" style="font-size:19px">' + esc(c ? c.title : 'Canal') + '</h1><div class="small muted">' + esc(c ? c.author || '' : '') + '</div></div></div>' +
      '<div class="row gap8 mb8"><button class="btn" data-act="podkeep" data-id="' + esc(p.id) + '">Retenção: ' + esc(c ? keepLabel(c.keepPolicy) : '') + '</button>' +
      '<button class="btn danger" data-act="podrm" data-id="' + esc(p.id) + '">Remover</button></div>' + body + '</div>';
  }

  // --------------------------------------------------------------------- auto ---
  function carHtml() {
    var t = S.cur(), st = S.storage;
    var pct = st && st.limit ? Math.min(100, Math.round(st.used / st.limit * 100)) : (st && st.diskTotal ? Math.round((st.diskTotal - st.diskFree) / st.diskTotal * 100) : 0);
    return '<div class="screen stack car"><div><div class="eyebrow" style="color:var(--amber)">Direção segura</div><h1 class="h1">Auto & Servidor</h1></div>' +
      '<div class="card" style="text-align:center"><div class="h2 trunc">' + esc(t ? t.title : 'Nada tocando') + '</div><div class="small muted trunc">' + esc(t ? t.artist : '—') + '</div></div>' +
      '<button class="big green" data-act="toggleplay"><span id="car-play">' + (S.playing ? I.pause : I.play) + '</span>' + '<span id="car-play-l">' + (S.playing ? 'Pausar' : 'Tocar') + '</span></button>' +
      '<div class="grid2"><button class="big" data-act="prev">' + I.prev + '</button><button class="big" data-act="next">' + I.next + '</button></div>' +
      '<div class="card"><div class="row between mb8"><div class="h2">Armazenamento do servidor</div><span class="small muted">' + (st ? S.fmtBytes(st.used) + (st.limit ? ' de ' + S.fmtBytes(st.limit) : '') : '…') + '</span></div>' +
      '<div class="bar"><i style="width:' + pct + '%"></i></div>' +
      '<div class="xs muted mt8">' + (st && st.diskTotal ? S.fmtBytes(st.diskFree) + ' livres de ' + S.fmtBytes(st.diskTotal) : '') + (st && st.full ? ' · ' + esc(st.reason || 'cheio') : '') + '</div></div>' +
      (S.auth.isAdmin ? '<div class="card row between"><div><div class="h2">Duplicatas</div><div class="small muted">' +
        (S.dups ? S.dups.groups + ' músicas repetidas · ' + S.fmtBytes(S.dups.bytes) : 'Toque em Verificar') + '</div></div>' +
        '<div class="row gap8"><button class="btn sm" data-act="dupscan">Verificar</button>' +
        (S.dups && S.dups.groups ? '<button class="btn green sm" data-act="dupclean">Limpar</button>' : '') + '</div></div>' : '') +
      (S.themeCard ? S.themeCard() : '') +
      (S.langCard ? S.langCard() : '') +
      '<div class="card row between"><div><div class="h2">Offline neste aparelho</div><div class="small muted" id="off-summary">' + S.offlineSummary() + '</div></div>' +
      '<button class="btn sm" data-act="off-open">Gerenciar</button></div>' +
      '<div class="card row between"><div><div class="h2">' + esc(S.auth.name || S.auth.username) + (S.auth.isAdmin ? ' <span class="pill g">admin</span>' : '') + '</div>' +
      '<div class="small muted">' + esc(S.base() || location.host) + '</div></div><button class="btn danger sm" data-act="logout">Sair</button></div>' +
      '<div class="xs muted" style="text-align:center">Guitarr · Seu Self-Hosted Music Player</div></div>';
  }

  // ------------------------------------------------------------------ render ---
  function pageHtml(p) {
    if (p.type === 'album') return albumPage(p);
    if (p.type === 'artist') return artistPage(p);
    if (p.type === 'playlist') return playlistPage(p);
    if (p.type === 'podcast') return podcastPage(p);
    return empty('Tela desconhecida');
  }
  S.render = function () {
    var v = $('view'); if (!v || !S.auth) return;
    var top = S.pages[S.pages.length - 1];
    if (curViewKey) scrollMem[curViewKey] = v.scrollTop;
    listSeq = 0; lists = {};
    var key = top ? top.type + ':' + top.id : S.tab;
    var html;
    try {
      html = top ? pageHtml(top) : S.tab === 'seer' ? seerHtml() : S.tab === 'library' ? libraryHtml()
        : S.tab === 'podcasts' ? podcastsHtml() : S.tab === 'car' ? carHtml() : homeHtml();
    } catch (e) { html = '<div class="empty" style="color:var(--red)">Erro ao desenhar a tela: ' + esc(S.errMsg(e)) + '</div>'; if (window.console) console.error(e); }
    v.innerHTML = html;
    v.scrollTop = scrollMem[key] || 0;
    curViewKey = key;
    var nav = $('nav');
    if (nav) Array.prototype.forEach.call(nav.querySelectorAll('button'), function (b) { b.classList.toggle('on', b.dataset.tab === S.tab); });
  };
  function reRenderLists() { // atualiza só as listas, sem perder o foco do campo de busca
    var h = $('home-list'); if (h) { listSeq = 0; h.innerHTML = homeListHtml(); }
  }

  // ---------------------------------------------------------------- player UI ---
  var NP_REPEAT = { off: '', all: ' on', one: ' on' };
  S.paint = function () {
    var t = S.cur(), mini = $('mini'), np = $('np');
    document.body.classList.toggle('playing', !!S.playing);
    $('app').classList.toggle('playing', !!S.playing);
    if (!mini) return;
    if (!t) { mini.classList.add('hidden'); } else {
      mini.classList.remove('hidden');
      var fav = S.isFav(t);
      mini.innerHTML = '<div class="top" data-act="np-open">' + art(trackCover(t, 120), 'r12 a44') +
        '<div class="grow"><div class="small trunc" style="font-weight:800">' + esc(t.title) + (t.kind === 'song' && S.quality(t) ? ' <span class="pill g" style="font-size:8px">' + esc(S.quality(t)) + '</span>' : '') + '</div>' +
        '<div class="xs muted trunc">' + esc(t.artist) + '</div></div>' +
        '<div class="ctrl">' + (t.kind === 'song' ? '<button data-act="fav" style="color:' + (fav ? 'var(--green)' : 'var(--muted)') + '">' + (fav ? I.heart : I.heartOff) + '</button>' : '') +
        '<button class="play" data-act="toggleplay">' + (S.playing ? I.pause : I.play) + '</button><button data-act="next">' + I.next + '</button></div></div>' +
        '<div class="prog"><i id="mini-fill" style="width:' + (S.dur ? Math.min(100, S.pos / S.dur * 100) : 0) + '%"></i></div>';
    }
    // dock sempre acima do conteúdo; sheet de reprodução
    var lfp = document.querySelector('#lyr-full .lf-play'); if (lfp) lfp.innerHTML = S.playing ? I.pause : I.play;
    var carPlay = $('car-play'); if (carPlay) { carPlay.innerHTML = S.playing ? I.pause : I.play; var l = $('car-play-l'); if (l) l.textContent = S.playing ? 'Pausar' : 'Tocar'; }
    if (np) paintNp();
  };
  function paintNp() {
    var t = S.cur(), np = $('np');
    if (!t) { np.innerHTML = ''; return; }
    var fav = S.isFav(t), spec = t.kind === 'song' ? [S.quality(t) || '', t.bitRate ? t.bitRate + ' kbps' : ''].filter(Boolean).join(' · ') : 'Podcast';
    np.innerHTML = '<div class="row between"><button class="icon-btn" data-act="np-close" aria-label="Fechar">' + I.down + '</button>' +
      '<div style="text-align:center;min-width:0"><div class="eyebrow">' + (t.kind === 'episode' ? 'Podcast' : 'Tocando da sua biblioteca') + '</div><div class="small trunc" style="font-weight:700;max-width:200px">' + esc(t.album) + '</div></div>' +
      '<button class="icon-btn" data-act="curmenu" aria-label="Opções">' + I.more + '</button></div>' +
      '<div class="cover art' + (S.playing ? '' : ' paused') + '" id="np-cover"><img src="' + esc(trackCover(t, 600)) + '" alt="" onerror="this.remove()"></div>' +
      '<div class="row between"><div class="grow"><div class="title trunc">' + esc(t.title) + '</div><div class="muted trunc" style="font-weight:600">' + esc(t.artist) + '</div></div>' +
      (t.kind === 'song' ? '<button class="icon-btn" data-act="fav" style="color:' + (fav ? 'var(--green)' : 'var(--text)') + '">' + (fav ? I.heart : I.heartOff) + '</button>' : '') + '</div>' +
      (spec ? '<div class="spec">' + esc(spec) + (S.offlineHas(t.id) ? ' · ↓ offline' : '') + '</div>' : '') +
      '<input type="range" id="np-seek" min="0" max="' + Math.max(1, Math.round(S.dur)) + '" value="' + Math.round(S.pos) + '" step="1">' +
      '<div class="row between small muted" style="font-family:ui-monospace,monospace"><span id="np-cur">' + S.fmtDur(S.pos) + '</span><span id="np-tot">' + S.fmtDur(S.dur) + '</span></div>' +
      '<div class="transport"><button data-act="shuffle" class="' + (S.shuffle ? 'on' : '') + '" aria-label="Aleatório">' + I.shuffle + '</button>' +
      '<button data-act="prev" aria-label="Anterior">' + I.prev + '</button>' +
      '<button class="main" data-act="toggleplay" aria-label="Tocar">' + (S.playing ? I.pause : I.play) + '</button>' +
      '<button data-act="next" aria-label="Próxima">' + I.next + '</button>' +
      '<button data-act="repeat" class="' + (S.repeat !== 'off' ? 'on' : '') + '" aria-label="Repetir" style="position:relative">' + I.repeat + (S.repeat === 'one' ? '<span style="position:absolute;right:6px;top:4px;font-size:10px;font-weight:900">1</span>' : '') + '</button></div>' +
      '<div class="row between"><button class="btn sm" data-act="queue">Fila (' + S.q.length + ')</button>' +
      (t.kind === 'song' ? '<button class="btn sm" data-act="lyr-full" id="np-lyr-btn">Letra em tela cheia</button>' : '') + '</div>' +
      '<div class="lyrics hidden" id="np-lyrics"></div>';
    paintLyrics();
  }
  S.paintProgress = function () {
    var f = $('mini-fill'); if (f) f.style.width = (S.dur ? Math.min(100, S.pos / S.dur * 100) : 0) + '%';
    var sk = $('np-seek');
    if (sk && !S.seeking) { sk.max = Math.max(1, Math.round(S.dur)); sk.value = Math.round(S.pos); sk.style.setProperty('--p', (S.dur ? S.pos / S.dur * 100 : 0) + '%'); }
    var c = $('np-cur'); if (c) c.textContent = S.fmtDur(S.pos);
    var tt = $('np-tot'); if (tt) tt.textContent = S.fmtDur(S.dur);
    if (S.lyrics && S.lyrics.synced) activeLyric();
  };
  S.paintRows = function () {
    var t = S.cur();
    Array.prototype.forEach.call(document.querySelectorAll('.song[data-id]'), function (el) {
      el.classList.toggle('cur', !!t && el.getAttribute('data-id') === t.id);
    });
  };
  // Letra: caixa no player cheio e tela cheia (#lyr-full) com a capa ao fundo; tocar numa linha
  // sincronizada pula para ela.
  function lyricLines(ly) {
    return ly.lines.map(function (l, i) { return '<p data-i="' + i + '"' + (ly.synced ? ' data-act="lyr-seek"' : '') + '>' + (esc(l.v) || '♪') + '</p>'; }).join('');
  }
  function lyricsMsg() {
    var t = S.cur();
    if (!t || t.kind !== 'song') return 'Sem letra para podcast.';
    return !S.lyrics ? 'Procurando a letra…' : 'Nenhuma letra encontrada.';
  }
  function paintLyrics() {
    var el = $('np-lyrics'), ly = S.lyrics, has = ly && ly.lines && ly.lines.length;
    lastLy = -1;
    if (el) {
      var t = S.cur();
      el.classList.toggle('hidden', !t || t.kind !== 'song');
      el.innerHTML = has ? lyricLines(ly) + '<div class="xs muted" style="margin-top:8px">' + (ly.synced ? 'Sincronizada' : 'Texto') + ' · ' + esc(ly.source || '') + '</div>'
        : '<div class="small muted' + (!ly ? ' pulse' : '') + '">' + lyricsMsg() + '</div>';
    }
    paintLyrFull();
    activeLyric();
  }
  S.paintLyrics = paintLyrics;
  function paintLyrFull() {
    var f = $('lyr-full'); if (!f || f.classList.contains('hidden')) return;
    var t = S.cur(), ly = S.lyrics;
    if (!t) { closeLyrFull(); return; }
    f.innerHTML = '<img class="lf-bg" src="' + esc(trackCover(t, 600)) + '" alt="" onerror="this.remove()">' +
      '<div class="lf-top"><button class="icon-btn" data-act="lyr-close" aria-label="Fechar">' + I.down + '</button>' +
      '<div class="grow" style="min-width:0"><div class="small trunc" style="font-weight:900">' + esc(t.title) + '</div><div class="xs trunc" style="opacity:.75">' + esc(t.artist) + '</div></div>' +
      '<button class="icon-btn lf-play" data-act="toggleplay" aria-label="Tocar">' + (S.playing ? I.pause : I.play) + '</button></div>' +
      '<div class="lf-lines" id="lyr-full-lines">' + (ly && ly.lines && ly.lines.length ? lyricLines(ly) : '<p class="on">' + lyricsMsg() + '</p>') + '</div>';
  }
  function openLyrFull() {
    var f = $('lyr-full'); if (!f || !S.cur()) return;
    f.classList.remove('hidden'); lastLy = -1;
    paintLyrFull(); activeLyric();
    history.pushState({ lyr: 1 }, '');
  }
  function closeLyrFull(fromPop) {
    var f = $('lyr-full'); if (!f || f.classList.contains('hidden')) return;
    f.classList.add('hidden'); f.innerHTML = ''; lastLy = -1; activeLyric();
    if (!fromPop && history.state && history.state.lyr) history.back();
  }
  var lastLy = -1;
  function activeLyric() {
    var ly = S.lyrics;
    if (!ly || !ly.synced) return;
    var idx = -1;
    for (var i = 0; i < ly.lines.length; i++) { if (ly.lines[i].t <= S.pos + 0.2) idx = i; else break; }
    if (idx === lastLy) return;
    lastLy = idx;
    [$('np-lyrics'), $('lyr-full-lines')].forEach(function (el) {
      if (!el) return;
      Array.prototype.forEach.call(el.querySelectorAll('p[data-i]'), function (p, i) { p.classList.toggle('on', i === idx); });
      var cur = el.querySelector('p[data-i="' + idx + '"]');
      if (cur) { var top = cur.offsetTop - el.clientHeight / 2 + cur.clientHeight / 2; try { el.scrollTo({ top: Math.max(0, top), behavior: 'smooth' }); } catch (e) { el.scrollTop = top; } }
    });
  }

  // ----------------------------------------------------------------- sheets ---
  function openSheet(html) {
    $('sheet').innerHTML = '<div class="grab"></div>' + html;
    $('sheet-bd').classList.add('open');
    history.pushState({ sheet: 1 }, '');
  }
  function closeSheet(fromPop) {
    if (!$('sheet-bd').classList.contains('open')) return;
    $('sheet-bd').classList.remove('open');
    if (!fromPop && history.state && history.state.sheet) history.back();
  }
  function openNp() { if (S.npOpen || !S.cur()) return; S.npOpen = true; paintNp(); $('np').classList.add('open'); history.pushState({ np: 1 }, ''); }
  function closeNp(fromPop) {
    if (!S.npOpen) return;
    S.npOpen = false; $('np').classList.remove('open');
    if (!fromPop && history.state && history.state.np) history.back();
  }
  function trackMenu(t) {
    if (!t) return;
    var fav = S.isFav(t), isSong = t.kind === 'song', off = S.offlineHas(t.id);
    S.menuTrack = t;
    openSheet('<div class="row" style="padding-bottom:12px;border-bottom:1px solid var(--line)">' + art(trackCover(t, 120), 'r12 a44') +
      '<div class="grow"><div class="small trunc" style="font-weight:800">' + esc(t.title) + '</div><div class="xs muted trunc">' + esc(t.artist) + (t.album ? ' · ' + esc(t.album) : '') + '</div></div></div>' +
      '<div class="mt8">' +
      (isSong ? '<button class="opt" data-act="m-fav"><span class="ic">' + (fav ? '♥' : '♡') + '</span>' + (fav ? 'Remover das Curtidas' : 'Curtir') + '</button>' : '') +
      '<button class="opt" data-act="m-next"><span class="ic">⏭</span>Tocar a seguir</button>' +
      '<button class="opt" data-act="m-queue"><span class="ic">＋</span>Adicionar à fila</button>' +
      (isSong && t.albumId ? '<button class="opt" data-act="m-album"><span class="ic">💿</span>Ir ao álbum</button>' : '') +
      (isSong && t.artistId ? '<button class="opt" data-act="m-artist"><span class="ic">🎤</span>Ir ao artista</button>' : '') +
      (isSong ? '<button class="opt" data-act="m-offline"><span class="ic" style="color:var(--green)">↓</span>' + (off ? 'Remover do offline' : 'Manter offline') + '</button>' : '') +
      (isSong && S.auth.isAdmin ? '<button class="opt" data-act="m-edit"><span class="ic" style="color:var(--purple)">✎</span>Editar tags (servidor)</button>' : '') +
      '</div><button class="btn" style="width:100%;margin-top:8px" data-act="sheet-close-btn">Fechar</button>');
  }
  function editTags(t) {
    var f = function (k, label, v, type) { return '<label class="field"><span>' + label + '</span><input class="input plain" data-k="' + k + '" ' + (type ? 'type="' + type + '"' : '') + ' value="' + esc(v) + '"></label>'; };
    openSheet('<div class="h2">Editar tags</div><div class="xs muted">As tags do arquivo são reescritas no servidor.</div>' +
      f('title', 'Título', t.title) + f('artist', 'Artista', t.artist) + f('album', 'Álbum', t.album) +
      f('trackNumber', 'Faixa', t.track || '', 'number') + f('year', 'Ano', t.year || '', 'number') +
      '<div class="row gap8 mt16"><button class="btn green grow" data-act="tags-save" data-id="' + esc(t.id) + '">Salvar</button><button class="btn" data-act="sheet-close-btn">Cancelar</button></div>');
  }
  function queueSheet() {
    var rows = S.q.map(function (t, i) {
      return '<div class="song' + (i === S.qi ? ' cur' : '') + '" data-act="skip" data-i="' + i + '"><span class="grow"><div class="t trunc">' + esc(t.title) + '</div><div class="s trunc">' + esc(t.artist) + '</div></span>' +
        (i === S.qi ? '<span class="pill g">tocando</span>' : '') + '</div>';
    }).join('');
    openSheet('<div class="h2 mb8">Fila (' + S.q.length + ')</div>' + (rows || empty('Fila vazia.')));
  }

  // ------------------------------------------------------------- dados / ações ---
  S.loadLibrary = async function () {
    var r = await Promise.all([S.fetchAll('song', 'title'), S.fetchAll('album', 'name'), S.fetchAll('artist', 'name'),
      S.apiJson('/api/playlist?_start=0&_end=200&_sort=name&_order=ASC').catch(function () { return []; })]);
    var songs = r[0].filter(function (s) { return !s.missing; }), albums = r[1].filter(function (a) { return !a.missing; });
    var artists = r[2].filter(function (a) { return !a.missing; });
    var podAlbum = {}, musicAlbum = {};
    songs.forEach(function (s) { ((/(^|\/)podcasts\//i.test(s.path || '')) ? podAlbum : musicAlbum)[s.albumId] = 1; s._pod = /(^|\/)podcasts\//i.test(s.path || ''); });
    songs = songs.filter(function (s) { return !s._pod; });
    albums = albums.filter(function (a) { return !(podAlbum[a.id] && !musicAlbum[a.id]); });
    S.tracks = songs.map(S.mkTrack);
    S.byId = {}; S.favs = {};
    S.tracks.forEach(function (t) { S.byId[t.id] = t; if (t.starred) S.favs[t.id] = true; });
    S.albums = albums.map(function (a) {
      return { id: a.id, name: a.name, artist: a.albumArtist || a.artist || '', artistId: a.albumArtistId, year: a.maxYear || a.minYear || 0,
        songCount: a.songCount || 0, createdAt: a.createdAt || '', rgid: a.mbzReleaseGroupId || '', artistMbid: a.mbzAlbumArtistId || '' };
    });
    S.artists = artists.filter(function (a) { return a.songCount; }).map(function (a) { return { id: a.id, name: a.name, albumCount: a.albumCount || 0, songCount: a.songCount || 0, mbid: a.mbzArtistId || '' }; });
    S.playlists = (r[3] || []).map(function (p) { return { id: p.id, name: p.name, songCount: p.songCount || 0 }; });
    S.plTracks = {};
    // a fila aponta para os objetos novos (starred etc.)
    S.q = S.q.map(function (t) { return t.kind === 'song' && S.byId[t.id] ? S.byId[t.id] : t; });
    S.loaded = true;
  };
  function offlineLibrary() { // sem rede: só o que está salvo no aparelho
    var d = S.offlineLibraryData();
    S.tracks = d.tracks; S.byId = {}; d.tracks.forEach(function (t) { S.byId[t.id] = t; });
    S.albums = d.albums; S.artists = [];
    S.playlists = d.playlists.map(function (p) { return { id: p.id, name: p.name, songCount: p.songCount }; });
    S.plTracks = {}; d.playlists.forEach(function (p) { S.plTracks[p.id] = p.ids.map(function (id) { return S.byId[id]; }).filter(Boolean); });
    S.loaded = true;
  }
  async function refreshRequests() {
    try {
      var list = (await S.apiJson('/api/seer/requests')) || [], changed = false, becameAvailable = false;
      list.forEach(function (r) {
        var prev = S.seer.lastStatus[r.id];
        if (prev && prev !== r.status) { changed = true; if (r.status === 'available') { becameAvailable = true; S.toast('Disponível: ' + (r.title || r.album)); } else if (r.status === 'failed') S.toast('Falhou: ' + (r.title || r.album)); }
        S.seer.lastStatus[r.id] = r.status;
      });
      S.seer.requests = list;
      var active = list.some(function (r) { return isActive(r.status); });
      var dot = $('seer-dot'); if (dot) dot.classList.toggle('hidden', !active);
      var qEl = $('seer-queue'); if (qEl) qEl.innerHTML = seerQueueHtml();
      if (changed) { var rs = $('seer-results'); if (rs && !S.seer.detail) rs.innerHTML = seerResultsHtml(); }
      if (becameAvailable) setTimeout(function () { S.loadLibrary().then(function () { if (!S.seer.q) S.render(); }).catch(function () {}); }, 5000);
    } catch (e) { /* sem rede: tenta no próximo ciclo */ }
  }
  async function seerSearch() {
    var q = S.seer.q.trim(), s = S.seer;
    if (!q) { s.results = []; s.loading = false; s.error = ''; var r0 = $('seer-results'); if (r0) r0.innerHTML = seerResultsHtml(); return; }
    s.loading = true; s.error = ''; s.detail = null;
    var rEl = $('seer-results'); if (rEl) rEl.innerHTML = seerResultsHtml();
    try { var res = await S.apiJson('/api/seer/catalog?q=' + encodeURIComponent(q) + '&limit=20'); if (s.q.trim() !== q) return; s.results = res || []; }
    catch (e) { if (s.q.trim() !== q) return; s.results = []; s.error = e.status === 502 ? 'O MusicBrainz não respondeu. Tente de novo.' : S.errMsg(e); }
    s.loading = false;
    rEl = $('seer-results'); if (rEl) rEl.innerHTML = seerResultsHtml();
  }
  function seerItem(src, i) {
    var d = S.seer.detail;
    if (src === 'h') return d && d.head ? Object.assign({ kind: 'album', mbid: d.head.mbid, coverId: d.head.coverId }, d.head) : null;
    if (src === 'd') return d && d.items[i] ? Object.assign({}, d.items[i]) : null;
    return S.seer.results[i];
  }
  async function podSearch() {
    var p = S.pod, q = p.q.trim(), src = p.src, el;
    if (!q) { p.results = []; p.searching = false; p.serr = ''; el = $('pod-results'); if (el) el.innerHTML = podResultsHtml(); return; }
    p.searching = true; p.serr = '';
    el = $('pod-results'); if (el) el.innerHTML = podResultsHtml();
    try {
      var res = await S.apiJson('/api/seer/podcasts/search?q=' + encodeURIComponent(q) + '&source=' + encodeURIComponent(src) + '&limit=15');
      if (p.q.trim() !== q || p.src !== src) return;
      p.results = res || [];
    } catch (e) {
      if (p.q.trim() !== q || p.src !== src) return;
      p.results = []; p.serr = 'A busca falhou: ' + S.errMsg(e);
    }
    p.searching = false;
    el = $('pod-results'); if (el) el.innerHTML = podResultsHtml();
  }
  async function podLoad() {
    S.pod.loading = true; S.pod.error = '';
    try { S.pod.channels = (await S.apiJson('/api/seer/podcasts')) || []; } catch (e) { S.pod.error = S.errMsg(e); S.pod.channels = []; }
    S.pod.loading = false;
    if (S.tab === 'podcasts' && !S.pages.length) S.render();
  }
  async function podEpisodes(id) {
    try { var d = await S.apiJson('/api/seer/podcasts/' + encodeURIComponent(id)); S.pod.episodes[id] = Array.isArray(d) ? d : (d && (d.episodes || d.Episodes)) || []; }
    catch (e) { S.pod.episodes[id] = []; S.toast('Erro ao abrir o canal: ' + S.errMsg(e)); }
    var top = S.pages[S.pages.length - 1]; if (top && top.type === 'podcast' && top.id === id) S.render();
  }
  async function loadStorage() { try { S.storage = await S.apiJson('/api/seer/storage'); } catch (e) {} }

  // --- navegação
  S.go = function (tab) {
    if (TABS.indexOf(tab) < 0) tab = 'home';
    S.tab = tab; S.pages = [];
    if (tab === 'podcasts' && !S.pod.channels.length && !S.pod.loading) podLoad();
    if (tab === 'car') { loadStorage().then(function () { if (S.tab === 'car' && !S.pages.length) S.render(); }); }
    if (tab === 'seer') refreshRequests();
    S.render(); S.saveLater();
  };
  function openPage(p) {
    S.pages.push(p); history.pushState({ pg: S.pages.length }, '');
    if (p.type === 'podcast' && !S.pod.episodes[p.id]) podEpisodes(p.id);
    S.render(); $('view').scrollTop = 0; S.saveLater();
  }
  function backPage() {
    if (history.state && history.state.pg) history.back();
    else { S.pages.pop(); S.render(); S.saveLater(); }
  }
  window.addEventListener('popstate', function () {
    if ($('sheet-bd').classList.contains('open')) { closeSheet(true); return; }
    if ($('lyr-full') && !$('lyr-full').classList.contains('hidden')) { closeLyrFull(true); return; }
    if (S.npOpen) { closeNp(true); return; }
    if (S.pages.length) { S.pages.pop(); S.render(); S.saveLater(); }
  });

  // --- cliques
  var A = {
    tab: function (d) { S.go(d.tab); },
    play: function (d) { var l = lists[d.list]; if (l) S.playList(l, Number(d.i)); },
    playall: function (d) { var l = lists[d.list]; if (l && l.length) S.playList(l, 0, { shuffle: !!d.shuffle }); },
    shuffleall: function () { var l = homeTracks(); if (l.length) S.playList(l, Math.floor(Math.random() * l.length), { shuffle: true }); },
    more: function () { S.homeLimit += 80; reRenderLists(); },
    filter: function (d) { S.filter = d.f; S.homeLimit = 60; S.render(); S.saveLater(); },
    libseg: function (d) { S.libSeg = d.s; S.render(); S.saveLater(); },
    album: function (d) { openPage({ type: 'album', id: d.id }); },
    artist: function (d) { openPage({ type: 'artist', id: d.id }); },
    playlist: function (d) { openPage({ type: 'playlist', id: d.id }); },
    podcast: function (d) { openPage({ type: 'podcast', id: d.id }); },
    back: function () { backPage(); },
    trackmenu: function (d, e) { e.stopPropagation(); var l = lists[d.list]; trackMenu(l && l[Number(d.i)]); },
    curmenu: function () { trackMenu(S.cur()); },
    'np-open': function () { openNp(); },
    'np-close': function () { closeNp(false); },
    toggleplay: function () { S.togglePlay(); },
    next: function () { S.next(false); },
    prev: function () { S.prev(); },
    shuffle: function () { S.toggleShuffle(); },
    repeat: function () { S.cycleRepeat(); },
    fav: function (d, e) { e.stopPropagation(); S.toggleFav(S.cur()); },
    queue: function () { queueSheet(); },
    'lyr-full': function () { openLyrFull(); },
    'lyr-close': function () { closeLyrFull(false); },
    'lyr-seek': function (d) {
      var l = S.lyrics && S.lyrics.lines[Number(d.i)];
      if (!l || l.t < 0) return;
      S.seek(l.t); lastLy = -1; activeLyric();
      if (!S.playing) S.togglePlay();
    },
    skip: function (d) { S.skipTo(Number(d.i)); closeSheet(false); },
    'sheet-close': function (d, e) { if (e.target.id === 'sheet-bd') closeSheet(false); },
    'sheet-close-btn': function () { closeSheet(false); },
    'm-fav': function () { var t = S.menuTrack; closeSheet(false); S.toggleFav(t); },
    'm-next': function () { var t = S.menuTrack; closeSheet(false); S.playNext(t); },
    'm-queue': function () { var t = S.menuTrack; closeSheet(false); S.enqueue(t); },
    'm-album': function () { var t = S.menuTrack; closeSheet(false); closeNp(false); setTimeout(function () { openPage({ type: 'album', id: t.albumId }); }, 60); },
    'm-artist': function () { var t = S.menuTrack; closeSheet(false); closeNp(false); setTimeout(function () { openPage({ type: 'artist', id: t.artistId }); }, 60); },
    'm-offline': async function () {
      var t = S.menuTrack; closeSheet(false);
      try { if (S.offlineHas(t.id)) await S.offlineRemove(t.id); else await S.offlineSave(t); } catch (e) { S.toast('Erro: ' + S.errMsg(e)); }
      S.render(); S.paint();
    },
    'm-edit': function () { var t = S.menuTrack; closeSheet(true); history.replaceState({ sheet: 1 }, ''); editTags(t); },
    'tags-save': async function (d) {
      var ch = {}; Array.prototype.forEach.call($('sheet').querySelectorAll('input[data-k]'), function (i) { ch[i.dataset.k] = i.value; });
      ['trackNumber', 'year'].forEach(function (k) { if (ch[k] === '') delete ch[k]; });
      try {
        await S.api('/api/seer/library/song/' + encodeURIComponent(d.id), { method: 'PUT', json: ch });
        closeSheet(false); S.toast('Tags salvas'); await S.loadLibrary(); S.render(); S.paint();
      } catch (e) { S.toast('Erro ao salvar: ' + S.errMsg(e)); }
    },
    offclear: async function () { if (confirm('Apagar todas as músicas salvas offline neste aparelho?')) { await S.offlineClear(); S.render(); S.paint(); } },
    seerdetail: async function (d) {
      var it = seerItem(d.src, Number(d.i)); if (!it || (it.kind !== 'artist' && it.kind !== 'album')) return;
      S.seer.loading = true; $('seer-results').innerHTML = seerResultsHtml();
      try {
        var r = await S.apiJson('/api/seer/catalog/' + it.kind + '/' + encodeURIComponent(it.mbid));
        S.seer.detail = { kind: it.kind, head: r[it.kind], items: it.kind === 'artist' ? r.albums : r.tracks };
      } catch (e) { S.toast('Erro: ' + S.errMsg(e)); }
      S.seer.loading = false; $('seer-results').innerHTML = seerResultsHtml();
    },
    seerback: function () { S.seer.detail = null; $('seer-results').innerHTML = seerResultsHtml(); },
    seeropen: function (d) {
      var it = seerItem(d.src, Number(d.i)); if (!it || !it.libraryId) return;
      if (it.kind === 'album') openPage({ type: 'album', id: it.libraryId });
      else if (it.kind === 'artist') openPage({ type: 'artist', id: it.libraryId });
      else { var t = S.byId[it.libraryId]; if (t) S.playList([t], 0); else S.toast('A faixa ainda não apareceu na biblioteca'); }
    },
    seerreq: async function (d) {
      var it = seerItem(d.src, Number(d.i)); if (!it) return;
      try {
        var rq = await S.apiJson('/api/seer/requests', { method: 'POST', json: it });
        if (rq && rq.id) { S.seer.requests = S.seer.requests.filter(function (r) { return r.id !== rq.id; }); S.seer.requests.unshift(rq); S.seer.lastStatus[rq.id] = rq.status; }
        S.toast('Pedido enviado: ' + (it.title || it.album || ''));
        refreshRequests();
      } catch (e) {
        S.toast(e.status === 409 ? 'Isso já está na biblioteca' : e.status === 507 ? 'Limite de armazenamento atingido' : 'Erro ao pedir: ' + S.errMsg(e));
      }
      var rs = $('seer-results'); if (rs) rs.innerHTML = seerResultsHtml();
      var qe = $('seer-queue'); if (qe) qe.innerHTML = seerQueueHtml();
    },
    retry: async function (d) { try { await S.api('/api/seer/requests/' + encodeURIComponent(d.id) + '/approve', { method: 'POST' }); S.toast('Tentando de novo'); refreshRequests(); } catch (e) { S.toast('Erro: ' + S.errMsg(e)); } },
    retryall: async function () {
      var failed = S.seer.requests.filter(function (r) { return r.status === 'failed'; }), ok = 0;
      for (var i = 0; i < failed.length; i++) { try { await S.api('/api/seer/requests/' + encodeURIComponent(failed[i].id) + '/approve', { method: 'POST' }); ok++; } catch (e) {} }
      S.toast(ok + ' pedidos reenviados'); refreshRequests();
    },
    import: async function () {
      var url = ($('imp-url').value || '').trim(); if (!url) { S.toast('Cole o link da playlist'); return; }
      try { await S.apiJson('/api/seer/imports', { method: 'POST', json: { url: url, sync: false, target: S.seer.impTarget || 'playlist' } }); S.toast('Importação iniciada'); $('imp-url').value = ''; refreshRequests(); }
      catch (e) { S.toast('Erro ao importar: ' + S.errMsg(e)); }
    },
    clearreqs: async function () {
      if (!window.confirm('Tirar da fila os pedidos concluídos e os que falharam? As músicas continuam na biblioteca.')) return;
      try { var r = await S.apiJson('/api/seer/requests?status=available,failed', { method: 'DELETE' }); S.toast((r && r.removed || 0) + ' pedidos removidos'); refreshRequests(); }
      catch (e) { S.toast('Erro ao limpar: ' + S.errMsg(e)); }
    },
    imptarget: function (d) {
      S.seer.impTarget = d.v;
      document.querySelectorAll('[data-act="imptarget"]').forEach(function (b) { b.classList.toggle('on', b.dataset.v === d.v); });
    },
    podrefresh: async function () { try { await S.api('/api/seer/podcasts/refresh-all', { method: 'POST' }); S.toast('Verificando todos os canais…'); setTimeout(podLoad, 5000); } catch (e) { S.toast('Erro: ' + S.errMsg(e)); } },
    podsrc: function (d) {
      S.pod.src = d.v;
      document.querySelectorAll('[data-act="podsrc"]').forEach(function (b) { b.classList.toggle('on', b.dataset.v === d.v); });
      if (S.pod.q.trim()) podSearch();
    },
    podfollow: function (d) {
      var r = S.pod.results[Number(d.i)]; if (!r) return;
      var key = r.feedUrl || r.url; if (!key) return;
      addWithRetention(r.title || key, { url: key, sourceType: r.sourceType || '' });
    },
    podadd: function () {
      var t = (prompt('Link do feed RSS, canal ou playlist do YouTube (ou digite o nome para buscar):') || '').trim(); if (!t) return;
      if (!/^https?:\/\//i.test(t)) { S.pod.q = t; podSearch(); S.render(); return; }
      addWithRetention(t, { url: t, feedUrl: t });
    },
    podmore: function (d) {
      S.pod.more = S.pod.more || {};
      S.pod.more[d.id] = !S.pod.more[d.id];
      S.render();
    },
    epdl: async function (d) { try { await S.api('/api/seer/podcasts/episodes/' + encodeURIComponent(d.id) + '/download', { method: 'POST' }); S.toast('Download do episódio iniciado'); setTimeout(function () { podEpisodes(d.ch); }, 4000); } catch (e) { S.toast('Erro: ' + S.errMsg(e)); } },
    podkeep: function (d) {
      var c = S.pod.channels.find(function (x) { return x.id === d.id; }); if (!c) return;
      pickRetention('Retenção: ' + c.title, c.keepPolicy, function (v) { changeRetention(c, v); });
    },
    keepset: function (d) {
      var cb = S.keepCb; S.keepCb = null;
      closeSheet(false);
      if (cb) cb(Number(d.v));
    },
    podrm: async function (d) {
      var c = S.pod.channels.find(function (x) { return x.id === d.id; });
      if (!confirm('Remover "' + (c ? c.title : 'este canal') + '" e apagar os ' + (c ? c.downloadedCount || 0 : 0) + ' episódio(s) baixado(s)?\n\nNão dá para desfazer.')) return;
      try { await S.api('/api/seer/podcasts/' + encodeURIComponent(d.id) + '?deleteFiles=true', { method: 'DELETE' }); S.pages = []; await podLoad(); S.render(); } catch (e) { S.toast('Erro: ' + S.errMsg(e)); }
    },
    dupscan: async function () {
      try { var r = await S.apiJson('/api/seer/duplicates'); S.dups = { groups: (r.groups || []).length, bytes: r.bytes || 0 }; S.render(); } catch (e) { S.toast('Erro: ' + S.errMsg(e)); }
    },
    dupclean: async function () {
      if (!confirm('Mover as cópias duplicadas para a lixeira do Guitarr (apagadas após 7 dias)?')) return;
      try { var r = await S.apiJson('/api/seer/duplicates/clean', { method: 'POST' }); S.toast('Duplicatas movidas (' + S.fmtBytes(r && r.bytes) + ' liberados)'); S.dups = null; loadStorage().then(S.render); setTimeout(function () { S.loadLibrary().catch(function () {}); }, 8000); }
      catch (e) { S.toast('Erro ao limpar: ' + S.errMsg(e)); }
    },
    logout: function () { if (confirm('Sair da conta neste aparelho?')) S.logout(); }
  };
  S.openSheet = openSheet; S.closeSheet = closeSheet;
  // Botão voltar do Android (native.js): fecha folha, player cheio ou tela aberta; false = nada a fechar
  S.handleBack = function () {
    if ($('sheet-bd').classList.contains('open')) { closeSheet(false); return true; }
    if ($('lyr-full') && !$('lyr-full').classList.contains('hidden')) { closeLyrFull(false); return true; }
    if (S.npOpen) { closeNp(false); return true; }
    if (S.pages.length) { backPage(); return true; }
    return false;
  };
  Object.assign(A, S.offActions || {});
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (!el) return;
    var act = el.dataset.act;
    var f = A[act] || (S.extraActions && S.extraActions[act]); // extras.js carrega depois
    if (f) f(el.dataset, e);
  });
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (t.id === 'home-q') { S.homeQ = t.value; S.homeLimit = 60; reRenderLists(); }
    else if (t.id === 'seer-q') { S.seer.q = t.value; clearTimeout(S.seer.timer); S.seer.detail = null; S.seer.timer = setTimeout(seerSearch, 450); }
    else if (t.id === 'pod-q') { S.pod.q = t.value; clearTimeout(S.pod.timer); S.pod.timer = setTimeout(podSearch, 600); }
    else if (t.id === 'np-seek') { S.seeking = true; S.pos = Number(t.value); var c = $('np-cur'); if (c) c.textContent = S.fmtDur(S.pos); t.style.setProperty('--p', (S.dur ? S.pos / S.dur * 100 : 0) + '%'); }
  });
  document.addEventListener('change', function (e) {
    if (e.target.id === 'np-seek') { S.seeking = false; S.seek(Number(e.target.value)); }
    if (e.target.id === 'imp-file') importFiles(e.target);
  });
  // CSV/JSON/TXT/ZIP do Exportify e afins: "Playlist" vira "auto" (Liked Songs -> Favoritos).
  async function importFiles(input) {
    var files = input.files; if (!files || !files.length) return;
    var t = S.seer.impTarget || 'playlist';
    var fd = new FormData();
    for (var i = 0; i < files.length; i++) fd.append('file', files[i], files[i].name);
    fd.append('target', t === 'playlist' ? 'auto' : t);
    S.toast('Enviando ' + (files.length > 1 ? files.length + ' arquivos' : files[0].name) + '…');
    try {
      var res = await S.apiJson('/api/seer/imports', { method: 'POST', form: fd });
      var jobs = Array.isArray(res) ? res : (res ? [res] : []);
      var fav = jobs.filter(function (j) { return j.target === 'favorites' || j.target === 'both'; }).length;
      S.toast(jobs.length + (jobs.length > 1 ? ' importações iniciadas' : ' importação iniciada') + (fav ? ' (' + fav + ' → Favoritos)' : ''));
      refreshRequests();
    } catch (e) { S.toast('Erro ao importar: ' + S.errMsg(e)); }
    input.value = '';
  }

  // ------------------------------------------------------------ login e boot ---
  S.showLogin = function (msg) {
    var el = $('login');
    var needSrv = S.needsServer();
    el.innerHTML = '<form id="login-form" class="stack"><div style="text-align:center"><img class="logo" src="../android-chrome-192x192.png" alt="">' +
      '<div class="h1" style="color:var(--green)">Guit<span style="color:var(--text)">arr</span></div><div class="small muted">Entre com sua conta</div></div>' +
      (needSrv ? '<label class="field"><span>Servidor</span><input class="input plain" id="lg-srv" type="url" placeholder="https://guitarr.seudominio.com" value="' + esc(S.ls(S.SERVER_KEY) || '') + '" required></label>' : '') +
      '<label class="field"><span>Usuário</span><input class="input plain" id="lg-user" autocomplete="username" autocapitalize="none" required></label>' +
      '<label class="field"><span>Senha</span><input class="input plain" id="lg-pass" type="password" autocomplete="current-password" required></label>' +
      '<div id="lg-err" class="small" style="color:var(--red);min-height:16px">' + esc(msg || '') + '</div>' +
      '<button class="btn green" style="width:100%;padding:13px" type="submit">Entrar</button></form>' +
      '<div class="seg" style="margin-top:14px">' + [['en', 'English'], ['pt', 'Português (BR)']].map(function (x) {
        return '<button data-notr class="' + (window.seerLang() === x[0] ? 'on' : '') + '" data-act="lang" data-v="' + x[0] + '">' + x[1] + '</button>';
      }).join('') + '</div>';
    el.classList.remove('hidden');
    $('login-form').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      var btn = ev.target.querySelector('button[type=submit]'); btn.disabled = true; $('lg-err').textContent = '';
      try {
        if (needSrv) S.ls(S.SERVER_KEY, $('lg-srv').value.trim().replace(/\/+$/, ''));
        await S.doLogin($('lg-user').value.trim(), $('lg-pass').value);
        el.classList.add('hidden'); el.innerHTML = '';
        boot();
      } catch (er) { $('lg-err').textContent = S.errMsg(er); } finally { btn.disabled = false; }
    });
  };
  S.logout = function () {
    S.auth = null; S.ls(S.AUTH_KEY, null); S.sessReady = false;
    try { window.__seerAudio.pause(); } catch (e) {}
    S.q = []; S.qi = 0; S.playing = false; $('mini').classList.add('hidden');
    S.showLogin('');
  };

  var booted = false, pollTimer = null;
  async function boot() {
    await S.offlineLoad();
    $('seer-dot') && $('seer-dot').classList.add('hidden');
    try { await S.loadLibrary(); S.online = true; }
    catch (e) {
      if (!S.auth) return;
      if (e && e.status === undefined && !navigator.onLine) { S.online = false; offlineLibrary(); }
      else { S.toast('Erro ao carregar a biblioteca: ' + S.errMsg(e)); offlineLibrary(); S.online = false; }
    }
    var hash = (location.hash || '').replace('#', '');
    if (S.online) { await S.restore(); } else S.sessReady = false;
    if (hash && TABS.indexOf(hash) >= 0) { S.tab = hash; S.pages = []; }
    else if (hash === 'library' || hash === 'seer') S.tab = hash;
    S.render(); S.paint();
    if (S.online) {
      if (S.tab === 'podcasts') podLoad();
      refreshRequests();
      S.offlineSync();
      if (!pollTimer) pollTimer = setInterval(function () {
        if (!S.auth || document.visibilityState !== 'visible') return;
        var active = S.seer.requests.some(function (r) { return isActive(r.status); });
        if (active || S.tab === 'seer') refreshRequests();
      }, 5000);
    }
    booted = true;
  }
  window.addEventListener('online', function () { if (S.auth && !S.online) { S.online = true; boot(); } });
  window.addEventListener('offline', function () { S.online = false; if (S.tab === 'home') S.render(); });

  document.addEventListener('DOMContentLoaded', function () {
    S.loadAuth();
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform())) { navigator.serviceWorker.register('sw.js').catch(function () {}); }
    if (S.auth) boot(); else S.showLogin('');
  });
})();
