const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync(process.argv[2], 'utf8');
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => { const m = e.detail || e.message; if (!/tailwind/.test(String(m))) errors.push('jsdomError: ' + m); });
let missingLeft = 23;
const calls = [];
async function fakeFetch(url, opt = {}) {
  const u = new URL(url, 'http://localhost/');
  const p = u.pathname, m = (opt.method || 'GET').toUpperCase();
  calls.push(m + ' ' + p);
  const json = (o, st = 200, h = {}) => ({ ok: st < 400, status: st, headers: { get: (k) => h[k.toLowerCase()] || null }, json: async () => o, text: async () => JSON.stringify(o), blob: async () => new Blob(['x']) });
  if (m === 'PUT' && p.startsWith('/api/seer/library/')) { calls.push(m + ' ' + p); calls.push('BODY ' + opt.body); return json({ id: 'x', albumId: 'x' }); }
  if (p === '/api/missing' && m === 'DELETE') { missingLeft = 0; return json({ ids: [] }); }
  if (p === '/api/missing') { const n = Math.min(8, missingLeft); return json(Array.from({ length: n }, (_, i) => ({ id: 'm' + i, title: 'Faixa fantasma ' + i, path: 'Seer/X/Y/' + i + '.flac' })), 200, { 'x-total-count': String(missingLeft) }); }
  if (p === '/api/seer/library/metadata-report') return json({ songs: 10, songsWithAlbumMbid: 5, albumGroups: [], artistGroups: [{ variants: [{ name: 'ForFun', tracks: 8, albums: [], songIds: ['s1'] }, { name: 'Forfun', tracks: 0, albums: ['alb1', 'alb2'], songIds: null }] }], unknown: [], noMbid: [], noCover: [], noCoverTotal: 0 });
  if (['/api/song', '/api/album', '/api/artist', '/api/playlist', '/api/radio'].includes(p)) return json([], 200, { 'x-total-count': '0' });
  if (p === '/api/seer/state') return json({});
  if (p.startsWith('/api/seer/') ) return json([]);
  if (p.startsWith('/rest/')) return json({ 'subsonic-response': { status: 'ok' } });
  return json({}, 404);
}
(async () => {
  const dom = new JSDOM(html, { url: 'http://localhost/app/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.fetch = fakeFetch;
      w.localStorage.setItem('nd_seer_pro_auth', JSON.stringify({ token: 'T', username: 'user', name: 'user', isAdmin: true, salt: 's', subToken: 't', id: 'u1' }));
      w.localStorage.setItem('nd_seer_lang', 'pt');
      w.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
      w.HTMLMediaElement.prototype.pause = function () {};
      w.confirm = () => true; w.scrollTo = () => {};
    } });
  const w = dom.window, d = w.document;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(800);
  const ok = (c, msg) => { if (!c) errors.push('FALHOU: ' + msg); else console.log('ok  -', msg); };
  const nav = d.getElementById('nav-meta');
  ok(!!nav, 'botão Organizar Metadados existe');
  nav.click(); await wait(600);
  try { w.eval("renderMetaViewInner"); } catch(e) {}
  w.document.defaultView.addEventListener('error',()=>{});
  let v = d.getElementById('view-content').innerHTML; console.log(w.state && w.state.currentView, calls.join('|'), v.slice(0,300).replace(/\s+/g,' '));
  ok(v.indexOf('Registros de arquivos ausentes (23)') > 0, 'seção mostra 23 registros');
  ok(v.indexOf('Faixa fantasma 0') > 0 && v.indexOf('Mostrando 8 de 23') > 0, 'lista amostra de 8');
  ok(v.indexOf('metaPurgeMissing()') > 0, 'botão de apagar aparece');
  ok(v.indexOf('metaMergeArtists(0)') > 0, 'grupo de artistas aparece');
  await w.metaMergeArtists(0); await wait(300);
  ok(calls.includes('PUT /api/seer/library/album/alb1') && calls.includes('PUT /api/seer/library/album/alb2'), 'unificar artista com songIds=null edita os 2 álbuns');
  ok(calls.includes('BODY {"albumArtist":"ForFun"}'), 'grava o nome canônico');
  w.metaPurgeMissing(); await wait(800);
  v = d.getElementById('view-content').innerHTML;
  ok(calls.includes('DELETE /api/missing'), 'chamou DELETE /api/missing (sem ids)');
  ok(v.indexOf('Nenhum registro fantasma') > 0, 'depois de apagar mostra ✓');
  console.log(errors.length ? errors.join('\n') : 'SEM ERROS');
  process.exit(errors.length ? 1 : 0);
})();
