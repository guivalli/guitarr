'use strict';
/* Recursos que o site já tinha: SmartRadio/Daylist na Início, ordenar músicas, discografia com faltantes
   e temas. Mesma lógica do live.js, adaptada às faixas do app (S.tracks). As chaves do localStorage
   são as mesmas do site (mesma origem em /app/), então ordem, histórico dos mixes e tema valem para os dois. */
(function () {
  var S = window.S, $ = S.$, esc = S.esc, I = S.I;
  var A = S.extraActions = {};

  // ------------------------------------------------------------------ temas ---
  var THEMES = [['dark', 'Escuro'], ['oled', 'OLED'], ['light', 'Claro']];
  function themeNow() { var t = S.ls('seer_theme'); return t === 'oled' || t === 'light' ? t : 'dark'; }
  S.applyTheme = function (t) {
    document.documentElement.setAttribute('data-theme', t);
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.content = t === 'light' ? '#eef0f4' : t === 'oled' ? '#000000' : '#050507';
  };
  S.setTheme = function (t, fromServer) {
    if (!THEMES.some(function (x) { return x[0] === t; })) return;
    S.ls('seer_theme', t); S.applyTheme(t);
    if (!fromServer && S.auth) S.api('/api/seer/state', { method: 'PUT', json: { theme: { name: t } } }).catch(function () {});
  };
  S.themeCard = function () {
    var cur = themeNow();
    return '<div class="card"><div class="h2 mb8">Tema</div><div class="seg">' + THEMES.map(function (x) {
      return '<button class="' + (cur === x[0] ? 'on' : '') + '" data-act="theme" data-v="' + x[0] + '">' + x[1] + '</button>';
    }).join('') + '</div><div class="xs muted mt8">Vale para a sua conta, aqui e no site.</div></div>';
  };
  A.theme = function (d) { S.setTheme(d.v); S.render(); };

  // ----------------------------------------------------------------- idioma ---
  // i18n.js (embutido no <head>) traduz os textos; a escolha vai para a conta (chave prefs) e vale no site.
  S.langCard = function () {
    return '<div class="card"><div class="h2 mb8">Idioma</div><div class="seg">' + [['en', 'English'], ['pt', 'Português (BR)']].map(function (x) {
      return '<button data-notr class="' + (window.seerLang() === x[0] ? 'on' : '') + '" data-act="lang" data-v="' + x[0] + '">' + x[1] + '</button>';
    }).join('') + '</div><div class="xs muted mt8">Idioma da interface. Vale para a sua conta, aqui e no site.</div></div>';
  };
  A.lang = function (d) {
    var saved = S.auth ? S.api('/api/seer/state', { method: 'PUT', json: { prefs: { lang: d.v } } }).catch(function () {}) : Promise.resolve();
    saved.then(function () { window.seerSetLang(d.v); });
  };
  S.applyTheme(themeNow());

  // ------------------------------------------------------- ordenar músicas ---
  var SORTS = [['added', 'Recentes', -1], ['title', 'Nome', 1], ['artist', 'Artista', 1], ['album', 'Álbum', 1],
    ['year', 'Ano', -1], ['plays', 'Mais tocadas', -1], ['lastPlayed', 'Tocadas há pouco', -1], ['duration', 'Duração', 1], ['quality', 'Qualidade', -1]];
  var sort = { key: 'added', dir: -1 };
  try { var ss = JSON.parse(S.ls('seer_song_sort') || 'null'); if (ss && ss.key && SORTS.some(function (o) { return o[0] === ss.key; })) sort = ss; } catch (e) {}
  var coll = typeof Intl !== 'undefined' ? new Intl.Collator(window.seerLocale ? window.seerLocale() : 'pt-BR', { sensitivity: 'base', numeric: true }) : null;
  function cmpStr(a, b) { return coll ? coll.compare(a, b) : String(a).localeCompare(String(b)); }
  function sortVal(t, k) {
    switch (k) {
      case 'title': return t.title; case 'artist': return t.artist; case 'album': return t.album;
      case 'year': return t.year || 0; case 'plays': return t.plays || 0; case 'lastPlayed': return t.lastPlayed || '';
      case 'duration': return t.duration || 0; case 'quality': return t.lossless ? 100000 : (t.bitRate || 0);
      default: return t.added || '';
    }
  }
  S.sortSongs = function (list) {
    var k = sort.key, dir = sort.dir;
    return list.slice().sort(function (a, b) {
      var va = sortVal(a, k), vb = sortVal(b, k);
      var c = typeof va === 'number' ? va - vb : cmpStr(String(va), String(vb));
      return c ? c * dir : (cmpStr(a.artist, b.artist) || cmpStr(a.album, b.album) || (a.disc - b.disc) || (a.track - b.track));
    });
  };
  S.sortControl = function () {
    return '<div class="row gap8"><select id="song-sort" class="sort-sel" aria-label="Ordenar">' + SORTS.map(function (o) {
      return '<option value="' + o[0] + '"' + (o[0] === sort.key ? ' selected' : '') + '>' + o[1] + '</option>';
    }).join('') + '</select><button class="icon-btn" data-act="sortdir" aria-label="Inverter a ordem" style="width:32px;height:32px">' +
      '<svg viewBox="0 0 24 24" style="width:16px;height:16px;fill:currentColor;transform:rotate(' + (sort.dir > 0 ? 0 : 180) + 'deg)"><path d="M11 20V7.8l-5.6 5.6L4 12l8-8 8 8-1.4 1.4L13 7.8V20z"/></svg></button></div>';
  };
  function saveSort() { S.ls('seer_song_sort', JSON.stringify(sort)); S.render(); S.saveLater(); }
  A.sortdir = function () { sort.dir = -sort.dir; saveSort(); };
  document.addEventListener('change', function (e) {
    if (e.target.id !== 'song-sort') return;
    var def = SORTS.find(function (o) { return o[0] === e.target.value; });
    sort = { key: e.target.value, dir: def ? def[2] : 1 };
    saveSort();
  });

  // ------------------------------------------------- mixes: SmartRadio e Daylist ---
  var RECENT = 'seer_mix_recent';
  var mix = { mode: 'geral', radioQueue: null, bump: parseInt(S.ls('seer_mix_bump') || '0', 10) || 0, daylists: null, dkey: '' };
  var RADIO_MODES = [['geral', 'Mix Geral'], ['descoberta', 'Descoberta'], ['favoritas', 'Favoritas'], ['energia', 'Energia'], ['relax', 'Relax']];
  var G_ENERGY = /rock|punk|metal|hardcore|grunge|electr|eletr|dance|edm|house|techno|trance|drum|dubstep|funk|hip ?hop|rap|trap|reggaeton|ska/i;
  var G_RELAX = /acoustic|acústic|acustic|folk|ambient|jazz|bossa|mpb|chill|lo-?fi|classical|clássic|piano|soul|r&b|rnb|soft|ballad|balada|new age|singer/i;
  var SLOTS = {
    manha: { title: 'Café da Manhã Musical', short: 'Manhã', da: 'da Manhã', sub: 'Leve, acústico e sem pressa', re: /acoustic|acústic|acustic|mpb|indie|pop|folk|bossa|soft|singer|samba|reggae/i, bpm: [80, 118] },
    tarde: { title: 'Foco & Ritmo da Tarde', short: 'Tarde', da: 'da Tarde', sub: 'Instrumental, lo-fi, rock e eletrônica', re: /instrumental|lo-?fi|classic rock|rock|electr|eletr|house|techno|trance|post|chill|soundtrack|trilha/i, week: true },
    noite: { title: 'Sessão da Noite', short: 'Noite', da: 'da Noite', sub: 'Seus gêneros principais e as mais bem avaliadas', top: true },
    madrugada: { title: 'Madrugada Chill', short: 'Madrugada', da: 'da Madrugada', sub: 'Ambient, jazz, R&B e baladas', re: /ambient|jazz|post-rock|post rock|r&b|rnb|soul|ballad|balada|slow|blues|chill|piano|classical|lo-?fi|dream/i, bpm: [1, 95] }
  };
  function slotNow(h) {
    h = h === undefined ? new Date().getHours() : h;
    return h >= 5 && h < 12 ? 'manha' : h >= 12 && h < 18 ? 'tarde' : h >= 18 && h < 23 ? 'noite' : 'madrugada';
  }
  function hashStr(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function shuffled(list, rand) { var a = list.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rand() * (i + 1)); var x = a[i]; a[i] = a[j]; a[j] = x; } return a; }
  function recentMix() { try { return JSON.parse(S.ls(RECENT) || '[]'); } catch (e) { return []; } }
  function rememberMix(ids) { S.ls(RECENT, JSON.stringify(recentMix().filter(function (id) { return ids.indexOf(id) < 0; }).concat(ids).slice(-50))); }
  function fav(t) { return S.isFav(t); }
  function genreOf(t) { return t.genres || t.genre || ''; }
  function topGenres(n) {
    var score = {};
    S.tracks.forEach(function (t) {
      var w = (fav(t) ? 5 : 0) + Math.min(t.plays || 0, 20) + (t.rating >= 4 ? 3 : 0);
      if (w) genreOf(t).split(/\s*[\/;,]\s*/).forEach(function (g) { g = g.trim(); if (g) score[g] = (score[g] || 0) + w; });
    });
    return Object.keys(score).sort(function (a, b) { return score[b] - score[a]; }).slice(0, n);
  }
  function inGenres(t, gs) { var g = genreOf(t).toLowerCase(); return gs.some(function (x) { return g.indexOf(x.toLowerCase()) >= 0; }); }
  // Smart Shuffle: o mesmo artista não volta antes de 4 faixas (quando dá).
  function smartShuffle(list, rand) {
    var byArtist = {}, order = [];
    shuffled(list, rand).forEach(function (t) { if (!byArtist[t.artist]) { byArtist[t.artist] = []; order.push(t.artist); } byArtist[t.artist].push(t); });
    var out = [];
    while (out.length < list.length) {
      var recent = out.slice(-3).map(function (t) { return t.artist; }), best = null, any = null;
      order.forEach(function (a) {
        var n = byArtist[a].length; if (!n) return;
        if (!any || n > byArtist[any].length) any = a;
        if (recent.indexOf(a) < 0 && (!best || n > byArtist[best].length)) best = a;
      });
      out.push(byArtist[best || any].shift());
    }
    return out;
  }
  function take(from, n, taken, rand, recent) {
    var free = from.filter(function (t) { return !taken[t.id]; });
    var fresh = free.filter(function (t) { return recent.indexOf(t.id) < 0; });
    var out = shuffled(fresh.length >= n ? fresh : free, rand).slice(0, n);
    out.forEach(function (t) { taken[t.id] = 1; });
    return out;
  }
  function addedRecently(list) {
    var d = list.filter(function (t) { return t.added; }).sort(function (a, b) { return String(b.added).localeCompare(String(a.added)); });
    return d.slice(0, Math.max(30, Math.round(d.length * 0.1)));
  }
  function radioBatch(mode, n, exclude, rand) {
    var all = S.tracks, taken = {}, recent = recentMix(), out = [];
    (exclude || []).forEach(function (id) { taken[id] = 1; });
    var tops = topGenres(5);
    if (mode === 'favoritas') out = take(all.filter(function (t) { return fav(t) || t.rating >= 4; }), n, taken, rand, recent);
    else if (mode === 'descoberta') {
      var unplayed = all.filter(function (t) { return !t.plays; });
      out = take(unplayed.filter(function (t) { return inGenres(t, tops); }), Math.round(n / 2), taken, rand, recent);
      out = out.concat(take(unplayed.length ? unplayed : all.filter(function (t) { return t.plays <= 1; }), n - out.length, taken, rand, recent));
    } else if (mode === 'energia') out = take(all.filter(function (t) { return G_ENERGY.test(genreOf(t)) || t.bpm >= 120; }), n, taken, rand, recent);
    else if (mode === 'relax') out = take(all.filter(function (t) { return G_RELAX.test(genreOf(t)) || (t.bpm > 0 && t.bpm < 100); }), n, taken, rand, recent);
    else {
      var played = all.filter(function (t) { return t.plays > 0; }).sort(function (a, b) { return b.plays - a.plays; });
      out = take(all.filter(fav), Math.round(n * 0.4), taken, rand, recent);
      out = out.concat(take(played.slice(0, Math.max(40, Math.round(played.length * 0.25))), Math.round(n * 0.3), taken, rand, recent));
      out = out.concat(take(all.filter(function (t) { return !t.plays && inGenres(t, tops); }), Math.round(n * 0.2), taken, rand, recent));
      out = out.concat(take(addedRecently(all), n - out.length, taken, rand, recent));
    }
    if (out.length < n) out = out.concat(take(all, n - out.length, taken, rand, recent));
    return smartShuffle(out, rand);
  }
  function daylists() {
    var slot = slotNow(), s = SLOTS[slot], all = S.tracks, day = new Date().toISOString().slice(0, 10);
    var tops = topGenres(3), weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
    function base(t) {
      if (s.top) return inGenres(t, tops) || t.rating >= 4 || fav(t);
      if (s.week && t.lastPlayed && t.lastPlayed >= weekAgo) return true;
      return (s.re && s.re.test(genreOf(t))) || (s.bpm && t.bpm >= s.bpm[0] && t.bpm <= s.bpm[1]);
    }
    var main = all.filter(base);
    var defs = [{ key: slot, title: s.title, sub: s.sub, pool: main }];
    tops.slice(0, 2).forEach(function (g) {
      defs.push({ key: slot + ':' + g, title: g + ' · ' + s.short, sub: 'O melhor de ' + g + ' para agora',
        pool: all.filter(function (t) { return inGenres(t, [g]) && (base(t) || main.length < 30); }) });
    });
    defs.push({ key: slot + ':fav', title: 'Favoritas ' + s.da, sub: 'Suas curtidas para o horário', pool: all.filter(fav) });
    return defs.slice(0, 4).map(function (d) {
      var rand = rng(hashStr(day + '|' + d.key + '|' + mix.bump)), recent = recentMix(), taken = {};
      var picks = take(d.pool, 30, taken, rand, recent);
      if (picks.length < 30) picks = picks.concat(take(all.filter(function (t) { return inGenres(t, tops); }), 30 - picks.length, taken, rand, recent));
      if (picks.length < 30) picks = picks.concat(take(all, 30 - picks.length, taken, rand, recent));
      picks = smartShuffle(picks, rand);
      var covers = [], seen = {};
      picks.forEach(function (t) { if (covers.length < 4 && !seen[t.albumId]) { seen[t.albumId] = 1; covers.push(S.coverUrl(t.albumId || ('mf-' + t.id), 150)); } });
      return { key: d.key, title: d.title, sub: d.sub, tracks: picks, covers: covers };
    });
  }
  function daylistsCached() {
    var key = new Date().toISOString().slice(0, 10) + '|' + slotNow() + '|' + mix.bump + '|' + S.tracks.length;
    if (key !== mix.dkey || !mix.daylists) { mix.dkey = key; mix.daylists = daylists(); }
    return mix.daylists;
  }
  function playMix(list, label) {
    if (!list.length) { S.toast('Nada para tocar ainda: curta ou toque algumas músicas primeiro'); return false; }
    rememberMix(list.map(function (t) { return t.id; }));
    S.shuffle = false;
    S.playList(list, 0);
    S.toast('Tocando ' + label);
    return true;
  }
  function radioOn() { return !!mix.radioQueue && S.q.length && S.q[0] === mix.radioQueue[0]; }
  A.smartradio = function (d) {
    if (d.mode) mix.mode = d.mode;
    var batch = radioBatch(mix.mode, 30, [], rng(hashStr(Date.now() + '|' + mix.mode)));
    var label = (RADIO_MODES.find(function (m) { return m[0] === mix.mode; }) || [, 'SmartRadio'])[1];
    mix.radioQueue = playMix(batch, 'SmartRadio · ' + label) ? S.q.slice(0, 1) : null;
    S.render();
  };
  A.daylist = function (d) { var x = daylistsCached()[Number(d.i)]; if (x) { mix.radioQueue = null; playMix(x.tracks, '"' + x.title + '"'); } };
  A.mixrefresh = function () {
    mix.bump++; S.ls('seer_mix_bump', String(mix.bump));
    (mix.daylists || []).forEach(function (d) { rememberMix(d.tracks.map(function (t) { return t.id; })); });
    mix.daylists = null; S.render(); S.toast('Mixes atualizados');
  };
  // SmartRadio infinito: nas 5 últimas faixas do lote, emenda mais 30.
  var prevNext = S.next;
  S.next = function (auto) {
    if (radioOn() && S.qi >= S.q.length - 5) {
      var more = radioBatch(mix.mode, 30, S.q.map(function (t) { return t.id; }), rng(hashStr(Date.now() + '|more')));
      S.q = S.q.concat(more);
      rememberMix(more.map(function (t) { return t.id; }));
    }
    return prevNext.apply(this, arguments);
  };
  function mosaic(c) {
    c = c.slice(0, 4);
    while (c.length && c.length < 4) c.push(c[0]);
    return '<span class="mosaic">' + c.map(function (u) { return '<img src="' + esc(u) + '" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'">'; }).join('') + '</span>';
  }
  S.mixesHtml = function () {
    if (!S.tracks.length || S.homeQ.trim() || S.filter !== 'all') return '';
    var on = radioOn();
    return '<div class="smartradio card"><div class="row between"><div class="grow"><div class="eyebrow" style="color:#9cc4ff">Mix infinito</div>' +
      '<div class="h1" style="color:#fff">SmartRadio</div><div class="xs" style="color:rgba(255,255,255,.75)">Feito com o que você curte e toca' + (on ? ' · <b style="color:#fff">tocando</b>' : '') + '</div></div>' +
      '<button class="btn white" data-act="smartradio">' + I.play + (on ? ' Novo lote' : ' Tocar') + '</button></div>' +
      '<div class="chips mt12">' + RADIO_MODES.map(function (m) {
        return '<button class="chip' + (on && mix.mode === m[0] ? ' on' : '') + '" data-act="smartradio" data-mode="' + m[0] + '">' + m[1] + '</button>';
      }).join('') + '</div></div>' +
      '<div><div class="row between mb8"><div><div class="h2">Daylist</div><div class="xs muted">Muda com a hora do dia</div></div>' +
      '<button class="btn sm" data-act="mixrefresh">↻ Atualizar</button></div><div class="grid2">' +
      daylistsCached().map(function (d, i) {
        return '<button class="album" data-act="daylist" data-i="' + i + '">' + mosaic(d.covers) +
          '<div class="t trunc">' + esc(d.title) + '</div><div class="s trunc">' + esc(d.sub) + '</div></button>';
      }).join('') + '</div></div>';
  };
  S.mixInternals = { radioBatch: radioBatch, daylists: daylists, slotNow: slotNow, mix: mix };

  // ----------------------------------------------- discografia do artista ---
  // Álbuns da biblioteca + a discografia oficial do MusicBrainz (Album/EP, sem coletâneas):
  // o que falta aparece em cinza com "+ Pedir".
  var disco = {}, discoFilter = 'all';
  var SKIP = /compilation|dj-mix|mixtape|demo|interview|remix|spokenword|audiobook/i;
  function foldTitle(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[([][^)\]]*(deluxe|remaster|edition|edição|edicao|expanded|anniversary|bonus|version|versão|reissue|special|mono|stereo)[^)\]]*[)\]]/g, ' ')
      .replace(/\s+-\s+.*(deluxe|remaster|edition|anniversary|version).*$/g, ' ')
      .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  }
  async function loadDisco(ar) {
    var k = ar.id;
    if (disco[k] && disco[k].state !== 'error') return;
    disco[k] = { state: 'loading', items: [] };
    try {
      var mbid = ar.mbid || '';
      if (!mbid) {
        var al = S.albums.find(function (a) { return a.artistId === ar.id && a.artistMbid; });
        mbid = al ? al.artistMbid.split(/[;,]/)[0].trim() : '';
      }
      if (!mbid) {
        var res = await S.apiJson('/api/seer/catalog?q=' + encodeURIComponent(ar.name) + '&limit=10');
        var want = foldTitle(ar.name);
        var hit = (res || []).find(function (c) { return c.kind === 'artist' && foldTitle(c.title || c.artist) === want; });
        mbid = hit ? hit.mbid : '';
      }
      if (!mbid) throw new Error('artista não encontrado no MusicBrainz');
      var d = await S.apiJson('/api/seer/catalog/artist/' + encodeURIComponent(mbid));
      disco[k] = { state: 'ok', items: ((d && d.albums) || []).filter(function (c) {
        return c.kind === 'album' && /^(album|ep)/i.test(c.type || 'album') && !SKIP.test(c.type || '');
      }) };
    } catch (e) { disco[k] = { state: 'error', items: [], error: S.errMsg(e) }; }
    var top = S.pages[S.pages.length - 1];
    if (top && top.type === 'artist' && top.id === ar.id) S.render();
  }
  function reqFor(c) { return S.seer.requests.find(function (r) { return r.mbid === c.mbid && r.kind === 'album' && r.status !== 'failed'; }); }
  function entries(ar, local) {
    var d = disco[ar.id], used = {}, out = [], byRg = {}, byTitle = {};
    local.forEach(function (a) { if (a.rgid) byRg[a.rgid] = a; byTitle[foldTitle(a.name)] = a; });
    ((d && d.items) || []).forEach(function (c) {
      var a = byRg[c.mbid] || byTitle[foldTitle(c.title)] || (c.inLibrary && c.libraryId && local.find(function (x) { return x.id === c.libraryId; }));
      if (a && used[a.id]) return;
      if (a) { used[a.id] = 1; out.push({ status: 'available', local: a, cat: c, year: c.year || a.year }); return; }
      var r = reqFor(c);
      out.push({ status: r && r.status !== 'available' ? 'pending' : (c.inLibrary ? 'available' : 'missing'), cat: c, req: r, year: c.year || 0 });
    });
    local.forEach(function (a) { if (!used[a.id]) out.push({ status: 'available', local: a, year: a.year }); });
    return out.sort(function (x, y) { return (Number(y.year) || 0) - (Number(x.year) || 0); });
  }
  S.discoHtml = function (ar, local) {
    if (!ar) return '';
    var d = disco[ar.id];
    if (!d && S.online) setTimeout(function () { loadDisco(ar); }, 0);
    var all = entries(ar, local), n = { all: all.length, available: 0, missing: 0 };
    all.forEach(function (e) { if (e.status === 'available') n.available++; else n.missing++; });
    var shown = all.filter(function (e) { return discoFilter === 'all' || (discoFilter === 'available' ? e.status === 'available' : e.status !== 'available'); });
    var chips = [['all', 'Todos (' + n.all + ')'], ['available', 'Na biblioteca (' + n.available + ')'], ['missing', 'Faltando (' + n.missing + ')']].map(function (c) {
      return '<button class="chip' + (discoFilter === c[0] ? ' on' : '') + '" data-act="discof" data-v="' + c[0] + '">' + c[1] + '</button>';
    }).join('');
    var cards = shown.map(function (e) {
      var c = e.cat, a = e.local, sub = (e.year || '') + (c && c.type ? ' · ' + c.type : '');
      if (e.status === 'available') {
        var id = a ? a.id : c.libraryId;
        return '<button class="album" data-act="album" data-id="' + esc(id) + '">' + '<span class="art r16"><img src="' + esc(a ? S.coverUrl(a.id, 300) : 'https://coverartarchive.org/release-group/' + c.mbid + '/front-250') + '" alt="" loading="lazy" onerror="this.remove()"></span>' +
          '<div class="t trunc">' + esc(a ? a.name : c.title) + '</div><div class="s trunc">' + esc(sub) + '</div></button>';
      }
      var badge = e.status === 'pending' ? '<span class="pill a disco-badge">' + (e.req && e.req.status === 'downloading' ? 'Baixando' : 'Pedido') + '</span>'
        : '<span class="pill disco-badge">Faltando</span>';
      return '<div class="album missing"><span class="art r16"><img src="https://coverartarchive.org/release-group/' + esc(c.mbid) + '/front-250" alt="" loading="lazy" onerror="this.remove()">' + badge + '</span>' +
        '<div class="t trunc">' + esc(c.title) + '</div><div class="s trunc">' + esc(sub) + '</div>' +
        (e.status === 'missing' ? '<button class="btn green sm mt8" style="width:100%" data-act="discoreq" data-ar="' + esc(ar.id) + '" data-mbid="' + esc(c.mbid) + '">+ Pedir</button>' : '') + '</div>';
    }).join('');
    var status = !d || d.state === 'loading' ? '<div class="xs muted pulse mb8">Buscando a discografia no MusicBrainz…</div>'
      : d.state === 'error' ? '<div class="xs mb8" style="color:var(--amber)">Discografia indisponível: ' + esc(d.error) + '</div>' : '';
    return '<div class="h2 mt16 mb8">Discografia</div><div class="chips mb8">' + chips + '</div>' + status +
      (cards ? '<div class="grid2">' + cards + '</div>' : '<div class="empty">' + (discoFilter === 'missing' && d && d.state === 'ok' ? 'Nada faltando: você tem a discografia oficial inteira.' : 'Nenhum álbum aqui.') + '</div>');
  };
  A.discof = function (d) { discoFilter = d.v; S.render(); };
  A.discoreq = async function (d) {
    var x = disco[d.ar], c = x && x.items.find(function (i) { return i.mbid === d.mbid; });
    if (!c) return;
    var fake = { id: 'tmp-' + c.mbid, kind: 'album', mbid: c.mbid, status: 'pending', title: c.title, artist: c.artist };
    S.seer.requests.unshift(fake); S.render();
    try {
      var rq = await S.apiJson('/api/seer/requests', { method: 'POST', json: c });
      S.seer.requests = S.seer.requests.filter(function (r) { return r !== fake && (!rq || r.id !== rq.id); });
      if (rq && rq.id) { S.seer.requests.unshift(rq); S.seer.lastStatus[rq.id] = rq.status; }
      S.toast('Pedido enviado: ' + c.title);
    } catch (e) {
      S.seer.requests = S.seer.requests.filter(function (r) { return r !== fake; });
      S.toast(e.status === 409 ? 'Esse álbum já está na biblioteca' : e.status === 507 ? 'Limite de armazenamento atingido' : 'Erro ao pedir: ' + S.errMsg(e));
    }
    S.render();
  };
})();
