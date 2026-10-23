// Teste de fumaça do app mobile em jsdom, com um servidor falso.
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync(process.argv[2], 'utf8');
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push('jsdomError: ' + (e.detail || e.message)));
vc.on('error', (e) => errors.push('console.error: ' + e));

const songs = [];
for (let i = 1; i <= 5; i++) songs.push({ id: 's' + i, title: 'Song ' + i, artist: 'Band', album: 'Album A', albumId: 'al1', artistId: 'ar1', albumArtistId: 'ar1',
  duration: 200 + i, suffix: i % 2 ? 'flac' : 'mp3', bitRate: 900, trackNumber: i, path: 'Seer/Band/Album A/' + i + '.flac', starred: i === 2 });
songs.push({ id: 'p1', title: 'Podcast Ep', artist: 'Pod', album: 'Pod', albumId: 'alp', artistId: 'arp', duration: 10, suffix: 'mp3', path: 'Seer/Podcasts/Pod/ep.mp3' });
let state = {};
const puts = [];
const posts = [];
async function fakeFetch(url, opt = {}) {
  const u = new URL(url, 'http://localhost/');
  const p = u.pathname, m = (opt.method || 'GET').toUpperCase();
  const json = (o, st = 200, h = {}) => ({ ok: st < 400, status: st, headers: { get: (k) => h[k.toLowerCase()] || null }, json: async () => o, text: async () => JSON.stringify(o), blob: async () => new Blob(['x']) });
  if (p === '/api/song') return json(songs, 200, { 'x-total-count': String(songs.length) });
  if (p === '/api/album') return json([{ id: 'al1', name: 'Album A', albumArtist: 'Band', albumArtistId: 'ar1', maxYear: 2001, songCount: 5, createdAt: '2026-01-01' },
    { id: 'alp', name: 'Pod', albumArtist: 'Pod', albumArtistId: 'arp', songCount: 1 }], 200, { 'x-total-count': '2' });
  if (p === '/api/artist') return json([{ id: 'ar1', name: 'Band', albumCount: 1, songCount: 5 }], 200, { 'x-total-count': '1' });
  if (p === '/api/playlist') return json([{ id: 'pl1', name: 'Minha', songCount: 2 }]);
  if (p === '/api/seer/state') { if (m === 'PUT') { puts.push(JSON.parse(opt.body)); Object.assign(state, JSON.parse(opt.body)); return json(state); } return json(state); }
  if (p === '/api/seer/requests') return json([{ id: 'r1', mbid: 'mb1', title: 'Pedida', artist: 'X', status: 'downloading', updatedAt: '2026-01-01' }]);
  if (p === '/api/seer/storage') return json({ used: 10e9, limit: 50e9, diskTotal: 500e9, diskFree: 400e9 });
  if (p === '/api/seer/podcasts/search') return json(u.searchParams.get('q') === 'nada' ? [] : [
    { title: 'Nerdcast', author: 'Jovem Nerd', feedUrl: 'https://x/nerd.rss', url: 'https://x/nerd', imageUrl: 'https://x/n.jpg', sourceType: 'rss' },
    { title: 'Canal Seguido', author: 'Y', feedUrl: 'https://x/seguido.rss', url: 'https://x/seguido', sourceType: 'youtube' }]);
  if (p === '/api/seer/podcasts' && m === 'POST') { posts.push(JSON.parse(opt.body)); return json({ id: 'c2', title: 'Nerdcast' }, 201); }
  if (p === '/api/seer/podcasts') return json([{ id: 'c1', title: 'Canal Seguido', feedUrl: 'https://x/seguido.rss', downloadedCount: 1, episodeCount: 2, keepPolicy: 1 }]);
  if (p === '/api/seer/catalog') return json([{ kind: 'album', mbid: 'mb9', title: 'Novo Álbum', artist: 'Band', year: 2020, coverId: 'mb9' },
    { kind: 'artist', mbid: 'mba', title: 'Band', artist: 'Band' }]);
  if (p === '/rest/stream') return json({}, 200, { 'content-length': '5' });
  if (p === '/rest/getPlaylist') return json({ 'subsonic-response': { status: 'ok', playlist: { entry: [songs[0], songs[1]] } } });
  if (p.startsWith('/rest/')) return json({ 'subsonic-response': { status: 'ok' } });
  return json({}, 404);
}

(async () => {
  const dom = new JSDOM(html, { url: 'http://localhost/app/mobile/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.fetch = fakeFetch;
      const store = new Map();
      w.Request = function (u) { this.url = u; };
      w.Response = function (body, o) { this._b = body; this.headers = { get: (k) => (o && o.headers || {})[k.toLowerCase()] || null }; this.blob = async () => this._b; };
      w.caches = { open: async () => ({ put: async (r, res) => { store.set(r.url, res); }, match: async (r) => store.get(r.url), delete: async (r) => store.delete(r.url) }),
        delete: async () => { store.clear(); return true; } };
      w.__cacheStore = store;
      w.localStorage.setItem('nd_seer_pro_auth', JSON.stringify({ token: 'T', username: 'user', name: 'user', isAdmin: true, salt: 's', subToken: 't', id: 'u1' }));
      w.localStorage.setItem('nd_seer_lang', 'pt');
      w.HTMLMediaElement.prototype.play = function () { this._p = true; return Promise.resolve(); };
      w.HTMLMediaElement.prototype.pause = function () { this._p = false; };
      w.Audio = function () { const a = w.document.createElement('audio'); return a; };
      w.scrollTo = () => {};
      w.confirm = () => true; w.prompt = () => null;
    } });
  const w = dom.window, d = w.document;
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(300);
  const ok = (c, msg) => { if (!c) errors.push('FALHOU: ' + msg); else console.log('ok  -', msg); };
  const view = () => d.getElementById('view').innerHTML;

  ok(w.S.tracks.length === 5, 'carregou 5 músicas (podcast fora)');
  ok(/Boa|Bom/.test(view()) && view().indexOf('Song 3') > 0, 'Início lista as músicas');
  // tocar a 3ª
  d.querySelector('.song[data-i="2"]').click();
  await wait(50);
  ok(w.S.cur() && w.S.cur().id === 's3' && w.S.playing, 'tocar a 3ª música');
  ok(!d.getElementById('mini').classList.contains('hidden') && d.getElementById('mini').innerHTML.indexOf('Song 3') > 0, 'mini-player aparece');
  // abas
  for (const tab of ['seer', 'library', 'podcasts', 'car', 'home']) {
    d.querySelector('#nav [data-tab="' + tab + '"]').click(); await wait(30);
  }
  d.querySelector('#nav [data-tab="podcasts"]').click(); await wait(50);
  const pq = d.getElementById('pod-q'); pq.value = 'nerd'; pq.dispatchEvent(new w.Event('input', { bubbles: true })); await wait(900);
  const pr = d.getElementById('pod-results').innerHTML;
  ok(pr.indexOf('Nerdcast') > 0 && pr.indexOf('Jovem Nerd') > 0, 'busca de podcasts mostra resultados');
  ok(pr.indexOf('Seguindo') > 0 && pr.indexOf('data-act="podfollow"') > 0, 'canal já seguido aparece como "Seguindo", o outro tem botão');
  d.querySelector('[data-act="podfollow"]').click(); await wait(100);
  ok(!!d.querySelector('[data-act="keepset"][data-v="-1"]'), 'seguir pergunta a retenção antes de gravar');
  ok(posts.length === 0, 'nenhum POST antes de escolher a retenção');
  d.querySelector('[data-act="keepset"][data-v="-1"]').click(); await wait(150);
  ok(posts.length === 1 && posts[0].url === 'https://x/nerd.rss' && posts[0].sourceType === 'rss' && posts[0].keepPolicy === -1, 'seguir envia url, sourceType e a retenção escolhida');
  d.querySelector('[data-act="podsrc"][data-v="youtube"]').click(); await wait(100);
  ok(w.S.pod.src === 'youtube' && d.querySelector('[data-act="podsrc"][data-v="youtube"]').classList.contains('on'), 'filtro de fonte muda');
  const pq2 = d.getElementById('pod-q'); pq2.value = 'nada'; pq2.dispatchEvent(new w.Event('input', { bubbles: true })); await wait(900);
  ok(d.getElementById('pod-results').innerHTML.indexOf('Nenhum podcast') > 0, 'busca sem resultado avisa');
  d.querySelector('#nav [data-tab="seer"]').click(); await wait(50);
  const sq = d.getElementById('seer-q'); sq.value = 'band'; sq.dispatchEvent(new w.Event('input', { bubbles: true })); await wait(700);
  ok(d.getElementById('seer-results').innerHTML.indexOf('Novo Álbum') > 0, 'busca do Guitarr mostra resultados');
  ok(d.getElementById('seer-queue').innerHTML.indexOf('Pedida') > 0, 'fila de pedidos aparece');
  d.querySelector('#nav [data-tab="library"]').click(); await wait(30);
  d.querySelector('[data-act="album"]').click(); await wait(30);
  ok(view().indexOf('Album A') > 0 && d.querySelectorAll('.song').length === 5, 'página do álbum lista 5 faixas');
  // ---- offline: faixa avulsa, álbum, limite, remover
  const S1 = w.S;
  await S1.offlineSave(S1.byId['s1']); await wait(400);
  ok(S1.offlineHas('s1') && w.__cacheStore.size === 1, 'offline: música avulsa baixada');
  await S1.offlineAddCollection('album', 'al1'); await wait(1200);
  const cs = S1.offlineColState('album', 'al1');
  ok(cs.state === 'ready' && cs.total === 5, 'offline: álbum inteiro baixado (' + JSON.stringify(cs) + ')');
  ok(w.__cacheStore.size === 5, 'offline: 5 arquivos no armazém (s1 é compartilhada com o álbum)');
  await S1.offlineRemove('s1'); await wait(100);
  ok(S1.offlineHas('s1'), 'offline: faixa de álbum offline não sai sozinha');
  await S1.offlineRemoveCollection('album:al1'); await wait(100);
  ok(Object.keys(S1.off.tracks).length === 1 && S1.offlineHas('s1') && w.__cacheStore.size === 1, 'offline: remover o álbum mantém só a faixa avulsa');
  S1.offActions['off-limit-set']({ gb: 0.001 });
  await S1.offlineAddCollection('playlist', 'pl1'); await wait(800);
  ok(S1.off.run.blocked.indexOf('Limite') === 0, 'offline: limite de 1 MB bloqueia a fila (' + S1.off.run.blocked + ')');
  await S1.offlineCancelQueue(); await wait(100);
  ok(Object.keys(S1.off.tracks).length === 1 && !S1.off.queue.length, 'offline: cancelar a fila descarta o que faltava');
  S1.offActions['off-quality-set']({ q: '128' });
  ok(S1.off.settings.quality === '128' && JSON.parse(w.localStorage.getItem('seer_offline_v2')).settings.quality === '128', 'offline: qualidade guardada');
  d.querySelector('#nav [data-tab="library"]').click(); await wait(30);
  S1.libSeg = 'offline'; S1.render();
  ok(d.getElementById('off-screen') && d.getElementById('off-screen').innerHTML.indexOf('Limite:') > 0, 'offline: tela de gerenciamento aparece');
  await S1.offlineClear(); await wait(50);
  ok(!Object.keys(S1.off.tracks).length && w.__cacheStore.size === 0, 'offline: apagar tudo');
  S1.libSeg = 'albums'; d.querySelector('#nav [data-tab="library"]').click(); await wait(30);
  d.querySelector('[data-act="album"]').click(); await wait(30);
  // sessão salva
  w.S.save(true); await wait(30);
  const last = puts[puts.length - 1];
  ok(last && last.playback && last.playback.trackId === 's3' && last.mobile && last.mobile.pages.length === 1, 'estado enviado ao servidor');
  // abrir player cheio
  d.querySelector('#mini .top').click(); await wait(30);
  ok(d.getElementById('np').classList.contains('open') && d.getElementById('np').innerHTML.indexOf('Song 3') > 0, 'player cheio abre');
  // recarregar: outra instância restaura
  const dom2 = new JSDOM(html, { url: 'http://localhost/app/mobile/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w2) {
      w2.fetch = fakeFetch;
      w2.localStorage.setItem('nd_seer_pro_auth', JSON.stringify({ token: 'T', username: 'user', name: 'user', isAdmin: true, salt: 's', subToken: 't', id: 'u1' }));
      w2.localStorage.setItem('nd_seer_lang', 'pt');
      w2.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
      w2.HTMLMediaElement.prototype.pause = function () {};
      w2.Audio = function () { return w2.document.createElement('audio'); };
      w2.confirm = () => true;
    } });
  dom2.window.document.dispatchEvent(new dom2.window.Event('DOMContentLoaded'));
  await wait(300);
  const S2 = dom2.window.S;
  ok(S2.cur() && S2.cur().id === 's3' && !S2.playing, 'recarregar retoma a faixa (pausada)');
  ok(S2.tab === 'library' && S2.pages.length === 1 && S2.pages[0].type === 'album', 'recarregar volta para a tela do álbum');
  console.log(errors.length ? errors.join('\n') : 'SEM ERROS');
  process.exit(errors.length ? 1 : 0);
})();
