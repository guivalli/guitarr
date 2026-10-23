// Teste da discografia do artista (Feature 1): local x MusicBrainz, filtros e pedido com 1 clique.
// Uso: node discosmoke.js ../../guitarr.html   (precisa de jsdom@24)
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync(process.argv[2], 'utf8');
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => { const m = e.detail || e.message; if (!/tailwind|getContext/.test(String(m))) errors.push('jsdomError: ' + m); });
const calls = [], bodies = [];
const songs = [1, 2].map((i) => ({ id: 's' + i, title: 'Faixa ' + i, artist: 'Banda', album: 'Disco', albumId: 'alb1', artistId: 'ar1', duration: 100, suffix: 'flac', bitRate: 900,
  trackNumber: i, path: 'Banda/Disco/' + i + '.flac', createdAt: '2026-01-0' + i }));
const requests = [{ id: 'r6', kind: 'album', mbid: 'rg6', status: 'downloading', title: 'Pedido Já', artist: 'Banda', createdAt: '2026-10-01' }];
async function fakeFetch(url, opt = {}) {
  const u = new URL(url, 'http://localhost/');
  const p = u.pathname, m = (opt.method || 'GET').toUpperCase();
  const json = (o, st = 200, h = {}) => ({ ok: st < 400, status: st, headers: { get: (k) => h[k.toLowerCase()] || null }, json: async () => o, text: async () => JSON.stringify(o) });
  if (m !== 'GET' || p.startsWith('/api/seer')) calls.push(m + ' ' + p);
  if (m !== 'GET' && opt.body) bodies.push(typeof opt.body === 'string' ? opt.body : '[form]');
  if (p === '/api/seer/state') return json({});
  if (p === '/api/seer/requests' && m === 'POST') { const b = JSON.parse(opt.body); const r = { id: 'r-' + b.mbid, kind: 'album', mbid: b.mbid, status: 'queued', title: b.title }; requests.unshift(r); return json(r, 201); }
  if (p === '/api/seer/requests') return json(requests);
  if (p === '/api/seer/catalog/artist/mbA') return json({ artist: { kind: 'artist', mbid: 'mbA', title: 'Banda' }, albums: [
    { kind: 'album', mbid: 'rg1', title: 'Disco (Deluxe Edition)', artist: 'Banda', year: 2010, type: 'Album' },
    { kind: 'album', mbid: 'rg2', title: 'Segundo (Remastered)', artist: 'Banda', year: 2014, type: 'Album' },
    { kind: 'album', mbid: 'rg3', title: 'Ao Vivo', artist: 'Banda', year: 2016, type: 'Album + Live' },
    { kind: 'album', mbid: 'rg4', title: 'Hits', artist: 'Banda', year: 2018, type: 'Album + Compilation' },
    { kind: 'album', mbid: 'rg5', title: 'Um Single', artist: 'Banda', year: 2019, type: 'Single' },
    { kind: 'album', mbid: 'rg6', title: 'Pedido Já', artist: 'Banda', year: 2020, type: 'EP' },
    { kind: 'album', mbid: 'rg7', title: 'Disco Duplicado', artist: 'Banda', year: 2010, type: 'Album', inLibrary: true, libraryId: 'alb1' }] });
  if (p === '/api/song') return json(songs, 200, { 'x-total-count': '2' });
  if (p === '/api/album') return json([{ id: 'alb1', name: 'Disco', albumArtist: 'Banda', albumArtistId: 'ar1', songCount: 2, maxYear: 2010, mbzReleaseGroupId: '' }], 200, { 'x-total-count': '1' });
  if (p === '/api/artist') return json([{ id: 'ar1', name: 'Banda', albumCount: 1, songCount: 2, mbzArtistId: 'mbA' }], 200, { 'x-total-count': '1' });
  if (['/api/playlist', '/api/radio', '/api/missing'].includes(p)) return json([], 200, { 'x-total-count': '0' });
  if (p.startsWith('/api/seer/')) return json([]);
  if (p.startsWith('/rest/')) return json({ 'subsonic-response': { status: 'ok' } });
  return json({}, 404);
}
(async () => {
  const dom = new JSDOM(html, { url: 'http://localhost/app/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.fetch = fakeFetch;
      w.localStorage.setItem('nd_seer_pro_auth', JSON.stringify({ token: 'T', username: 'user', name: 'user', isAdmin: true, salt: 's', subToken: 't', id: 'u1' }));
      w.localStorage.setItem('nd_seer_lang', 'pt');
      w.localStorage.setItem('seer_tour_done', '1');
      w.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
      w.HTMLMediaElement.prototype.pause = function () {};
      w.HTMLElement.prototype.scrollIntoView = function () {};
      w.confirm = () => true; w.scrollTo = () => {};
    } });
  const w = dom.window, d = w.document;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const ok = (c, msg) => { if (!c) errors.push('FALHOU: ' + msg); else console.log('ok  -', msg); };
  const view = () => d.getElementById('view-content').innerHTML;
  const discoHtml = () => (d.getElementById('artist-discography') || {}).innerHTML || '';
  await wait(900);
  w.openArtistByName('Banda'); await wait(500);
  const v = view();
  ok(calls.includes('GET /api/seer/catalog/artist/mbA'), 'usa o MBID do artista para buscar a discografia');
  ok(v.indexOf('Na Biblioteca (1)') > 0, '"Disco (Deluxe Edition)" e o duplicado contam como o álbum local');
  ok(v.indexOf('Faltando (3)') > 0, 'faltando: Segundo, Ao Vivo e o já pedido');
  ok(v.indexOf('Hits') < 0 && v.indexOf('Um Single') < 0, 'coletânea e single ficam de fora');
  ok(v.indexOf('Baixando') > 0, 'álbum já pedido mostra "Baixando"');
  ok((v.match(/\+ Pedir Álbum/g) || []).length === 2, 'botão "Pedir Álbum" só nos 2 que faltam de verdade');
  ok(v.indexOf('grayscale') > 0, 'capa do que falta fica cinza');
  const btn = [...d.querySelectorAll('#artist-discography button')].find((b) => /Pedir Álbum/.test(b.textContent) && b.getAttribute('onclick').includes('rg2'));
  btn.click(); await wait(400);
  ok(calls.includes('POST /api/seer/requests') && bodies.some((b) => b.includes('"mbid":"rg2"')), 'pedido enviado com o release-group certo');
  ok((view().match(/\+ Pedir Álbum/g) || []).length === 1, 'depois do pedido o álbum vira "Pedido"');
  w.seerDiscoFilter('missing'); await wait(100);
  ok(discoHtml().indexOf('>Disco<') < 0 && discoHtml().indexOf('Ao Vivo') > 0, 'filtro "Faltando" esconde os da biblioteca');
  w.seerDiscoFilter('available'); await wait(100);
  ok(view().indexOf('Ao Vivo') < 0 && view().indexOf('Disco') > 0, 'filtro "Na Biblioteca"');
  if (errors.length) { console.log(errors.join('\n')); process.exit(1); }
  console.log('SEM ERROS');
  process.exit(0);
})();
