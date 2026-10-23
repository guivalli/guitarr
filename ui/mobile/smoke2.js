// Teste dos recursos que vieram do site para o app: SmartRadio/Daylist, ordenar, discografia, letras e temas.
// Uso: node smoke2.js ../../apps/mobile/index.html   (precisa de jsdom@24)
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync(process.argv[2], 'utf8');
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push('jsdomError: ' + (e.detail || e.message)));
vc.on('error', (e) => errors.push('console.error: ' + e));

const genres = ['Rock', 'MPB', 'Jazz'];
const songs = [];
for (let i = 1; i <= 40; i++) {
  songs.push({ id: 's' + i, title: 'Song ' + String(i).padStart(2, '0'), artist: 'Band ' + (i % 4), album: i <= 5 ? 'Disco (Deluxe Edition)' : 'Album ' + (i % 6),
    albumId: i <= 5 ? 'al1' : 'alx' + (i % 6), artistId: 'ar' + (i % 4), albumArtistId: 'ar' + (i % 4), duration: 100 + i, suffix: 'mp3', bitRate: 320,
    trackNumber: i, path: 'x/' + i + '.mp3', starred: i % 5 === 0, playCount: i % 3 ? i : 0, genre: genres[i % 3], createdAt: '2026-10-' + String((i % 28) + 1).padStart(2, '0') });
}
let state = {};
const puts = [], posts = [];
async function fakeFetch(url, opt = {}) {
  const u = new URL(url, 'http://localhost/');
  const p = u.pathname, m = (opt.method || 'GET').toUpperCase();
  const json = (o, st = 200, h = {}) => ({ ok: st < 400, status: st, headers: { get: (k) => h[k.toLowerCase()] || null }, json: async () => o, text: async () => JSON.stringify(o) });
  if (p === '/api/song') return json(songs, 200, { 'x-total-count': String(songs.length) });
  if (p === '/api/album') return json([{ id: 'al1', name: 'Disco (Deluxe Edition)', albumArtist: 'Band 1', albumArtistId: 'ar1', maxYear: 2010, songCount: 5 }], 200, { 'x-total-count': '1' });
  if (p === '/api/artist') return json([{ id: 'ar1', name: 'Band 1', albumCount: 1, songCount: 10, mbzArtistId: 'mbA' }], 200, { 'x-total-count': '1' });
  if (p === '/api/playlist') return json([]);
  if (p === '/api/seer/state') { if (m === 'PUT') { const b = JSON.parse(opt.body); puts.push(b); Object.assign(state, b); } return json(state); }
  if (p === '/api/seer/requests' && m === 'POST') { const b = JSON.parse(opt.body); posts.push(b); return json({ id: 'r-' + b.mbid, kind: 'album', mbid: b.mbid, status: 'queued', title: b.title }, 201); }
  if (p === '/api/seer/requests') return json([]);
  if (p === '/api/seer/catalog/artist/mbA') return json({ artist: { kind: 'artist', mbid: 'mbA', title: 'Band 1' }, albums: [
    { kind: 'album', mbid: 'rg1', title: 'Disco', artist: 'Band 1', year: 2010, type: 'Album' },
    { kind: 'album', mbid: 'rg2', title: 'Segundo', artist: 'Band 1', year: 2014, type: 'Album' },
    { kind: 'album', mbid: 'rg3', title: 'Hits', artist: 'Band 1', year: 2018, type: 'Album + Compilation' }] });
  if (/^\/api\/seer\/lyrics\/s1\/lrclib$/.test(p)) return json([{ id: 1, duration: 101, synced: '[00:00.50] Primeira\n[00:10.00] Segunda\n[00:20.00] Terceira', plain: 'x' }]);
  if (/^\/api\/seer\/lyrics\/.*\/lrclib$/.test(p)) return json([]);
  if (p.startsWith('/api/seer/')) return json([]);
  if (p === '/rest/getLyricsBySongId') return json({ 'subsonic-response': { status: 'ok', lyricsList: { structuredLyrics: [] } } });
  if (p.startsWith('/rest/')) return json({ 'subsonic-response': { status: 'ok' } });
  return json({}, 404);
}

(async () => {
  const dom = new JSDOM(html, { url: 'http://localhost/app/mobile/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.fetch = fakeFetch;
      w.localStorage.setItem('nd_seer_pro_auth', JSON.stringify({ token: 'T', username: 'user', name: 'user', isAdmin: true, salt: 's', subToken: 't', id: 'u1' }));
      w.localStorage.setItem('nd_seer_lang', 'pt');
      w.localStorage.setItem('seer_theme', 'light');
      w.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
      w.HTMLMediaElement.prototype.pause = function () {};
      w.Audio = function () { return w.document.createElement('audio'); };
      w.scrollTo = () => {};
      w.HTMLElement.prototype.scrollTo = function () {};
      w.confirm = () => true; w.prompt = () => null;
    } });
  const w = dom.window, d = w.document;
  d.dispatchEvent(new w.Event('DOMContentLoaded'));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(400);
  const ok = (c, msg) => { if (!c) errors.push('FALHOU: ' + msg); else console.log('ok  -', msg); };
  const view = () => d.getElementById('view').innerHTML;

  // tema
  ok(d.documentElement.getAttribute('data-theme') === 'light', 'tema salvo no aparelho vale antes do login (claro)');
  // SmartRadio / Daylist
  ok(view().includes('SmartRadio') && view().includes('Daylist'), 'Início mostra SmartRadio e Daylist');
  ok(d.querySelectorAll('[data-act="daylist"]').length === 4, '4 Daylists');
  d.querySelector('[data-act="smartradio"][data-mode="favoritas"]').click(); await wait(50);
  ok(w.S.q.length === 30 && w.S.q.every((t) => t.starred || t.rating >= 4) === false && w.S.playing, 'SmartRadio Favoritas toca 30 (completa com o resto)');
  ok(w.S.q.filter((t) => t.starred).length === 8, 'SmartRadio Favoritas traz todas as 8 curtidas');
  w.S.qi = w.S.q.length - 4; w.S.next(false); await wait(30);
  ok(w.S.q.length === 40 && new Set(w.S.q.map((t) => t.id)).size === 40, 'SmartRadio emenda o lote seguinte sem repetir (só restavam 10)');
  d.querySelector('[data-act="daylist"]').click(); await wait(30);
  ok(w.S.q.length === 30, 'Daylist toca 30');
  // ordenar
  const sel = d.getElementById('song-sort');
  ok(!!sel, 'controle de ordenar na Início');
  sel.value = 'title'; sel.dispatchEvent(new w.Event('change', { bubbles: true })); await wait(30);
  const firstTitle = () => (d.querySelector('#home-list .song .t') || {}).textContent;
  ok(firstTitle() === 'Song 01', 'ordenar por nome');
  d.querySelector('[data-act="sortdir"]').click(); await wait(30);
  ok(firstTitle() === 'Song 40', 'inverter a ordem');
  ok(JSON.parse(w.localStorage.getItem('seer_song_sort')).key === 'title', 'ordem guardada (mesma chave do site)');
  // discografia
  w.S.go('library'); w.S.libSeg = 'artists'; w.S.render(); await wait(20);
  d.querySelector('[data-act="artist"][data-id="ar1"]').click(); await wait(300);
  const v = view();
  ok(v.includes('Discografia') && v.includes('Na biblioteca (1)') && v.includes('Faltando (1)'), '"Disco (Deluxe)" casa com "Disco"; falta "Segundo"; coletânea fora');
  d.querySelector('[data-act="discoreq"][data-mbid="rg2"]').click(); await wait(100);
  ok(posts.length === 1 && posts[0].mbid === 'rg2', 'pedido do álbum que falta');
  ok(!view().includes('data-act="discoreq"'), 'depois do pedido não oferece pedir de novo');
  // letras
  w.S.playList([w.S.byId.s1], 0); await wait(200);
  ok(w.S.lyrics && w.S.lyrics.synced && w.S.lyrics.source === 'LRCLIB' && w.S.lyrics.lines.length === 3, 'sem letra no arquivo: usa a sincronizada do LRCLIB (duração ±3 s)');
  d.querySelector('[data-act="np-open"]').click(); await wait(50);
  ok(d.getElementById('np-lyrics').textContent.includes('Segunda'), 'letra no player cheio');
  d.querySelector('[data-act="lyr-full"]').click(); await wait(50);
  const full = d.getElementById('lyr-full');
  ok(!full.classList.contains('hidden') && full.textContent.includes('Terceira'), 'letra em tela cheia');
  w.S.pos = 11; w.S.paintProgress(); await wait(20);
  ok((full.querySelector('p.on') || {}).textContent === 'Segunda', 'linha atual destacada pela posição');
  full.querySelector('p[data-i="2"]').click(); await wait(20);
  ok(Math.round(w.S.pos) === 20, 'tocar numa linha pula para ela');
  ok(w.S.handleBack() === true && full.classList.contains('hidden'), 'voltar fecha a tela cheia');
  w.S.playList([w.S.byId.s2], 0); await wait(200);
  ok(w.S.lyrics && !w.S.lyrics.lines.length && d.getElementById('np-lyrics').textContent.includes('Nenhuma letra'), 'sem letra: avisa');
  // tema pelo app
  w.S.go('car'); await wait(50);
  d.querySelector('[data-act="theme"][data-v="oled"]').click(); await wait(30);
  ok(d.documentElement.getAttribute('data-theme') === 'oled' && w.localStorage.getItem('seer_theme') === 'oled', 'trocar para OLED');
  ok(puts.some((b) => b.theme && b.theme.name === 'oled'), 'tema vai para /api/seer/state (vale no site também)');

  if (errors.length) { console.log(errors.join('\n')); process.exit(1); }
  console.log('SEM ERROS');
  process.exit(0);
})();
