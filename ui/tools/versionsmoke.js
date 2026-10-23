// Teste de "Outras versões" no editor de faixa: lista, confirmação, POST e acompanhamento do job.
// Uso: node versionsmoke.js ../../guitarr.html   (precisa de jsdom@24)
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync(process.argv[2], 'utf8');
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => { const m = e.detail || e.message; if (!/tailwind|getContext/.test(String(m))) errors.push('jsdomError: ' + m); });
const calls = [], bodies = [];
const songs = [{ id: 's1', title: 'Zóio de Lula', artist: 'Charlie Brown Jr.', album: 'Preço Curto', albumId: 'alb1', artistId: 'ar1', duration: 250,
  suffix: 'mp3', bitRate: 320, trackNumber: 1, path: 'CBJR/Preço Curto/01.mp3', createdAt: '2026-01-01' }];
const versions = [
  { source: 'musicbrainz', mbid: 'rec-live', title: 'Zóio de Lula', artist: 'Charlie Brown Jr.', album: 'Acústico MTV', year: 2003, durationMs: 262000, disambiguation: 'live' },
  { source: 'YouTube', url: 'https://www.youtube.com/watch?v=abc', title: 'Zóio de Lula <ao vivo>', artist: 'Charlie Brown Jr.', durationMs: 248000, channel: 'Charlie Brown Jr. - Topic' },
];
let jobPolls = 0;
async function fakeFetch(url, opt = {}) {
  const u = new URL(url, 'http://localhost/');
  const p = u.pathname, m = (opt.method || 'GET').toUpperCase();
  const json = (o, st = 200, h = {}) => ({ ok: st < 400, status: st, headers: { get: (k) => h[k.toLowerCase()] || null }, json: async () => o, text: async () => JSON.stringify(o) });
  if (m !== 'GET' || p.startsWith('/api/seer')) calls.push(m + ' ' + p);
  if (m !== 'GET' && opt.body) bodies.push(typeof opt.body === 'string' ? opt.body : '[form]');
  if (p === '/api/seer/state') return json({});
  if (p === '/api/seer/library/song/s1/versions' && m === 'GET') return json(versions);
  if (p === '/api/seer/library/song/s1/versions' && m === 'POST') return json({ songId: 's1', status: 'downloading', version: JSON.parse(opt.body) }, 202);
  if (p === '/api/seer/library/song/s1/versions/job') {
    if (!calls.includes('POST /api/seer/library/song/s1/versions')) return { ok: false, status: 404, headers: { get: () => null }, text: async () => 'no job' };
    jobPolls++;
    return json({ songId: 's1', status: jobPolls < 2 ? 'replacing' : 'done' });
  }
  if (p === '/api/song') return json(songs, 200, { 'x-total-count': '1' });
  if (p === '/api/album') return json([{ id: 'alb1', name: 'Preço Curto', albumArtist: 'Charlie Brown Jr.', albumArtistId: 'ar1', songCount: 1 }], 200, { 'x-total-count': '1' });
  if (p === '/api/artist') return json([{ id: 'ar1', name: 'Charlie Brown Jr.', albumCount: 1, songCount: 1 }], 200, { 'x-total-count': '1' });
  if (['/api/playlist', '/api/radio', '/api/missing'].includes(p)) return json([], 200, { 'x-total-count': '0' });
  if (p.startsWith('/api/seer/')) return json([]);
  if (p.startsWith('/rest/')) return json({ 'subsonic-response': { status: 'ok' } });
  return json({}, 404);
}
(async () => {
  let confirms = 0;
  const dom = new JSDOM(html, { url: 'http://localhost/app/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.fetch = fakeFetch;
      w.localStorage.setItem('nd_seer_pro_auth', JSON.stringify({ token: 'T', username: 'user', name: 'user', isAdmin: true, salt: 's', subToken: 't', id: 'u1' }));
      w.localStorage.setItem('nd_seer_lang', 'pt');
      w.localStorage.setItem('seer_tour_done', '1');
      w.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
      w.HTMLMediaElement.prototype.pause = function () {};
      w.HTMLElement.prototype.scrollIntoView = function () {};
      w.confirm = () => { confirms++; return true; }; w.scrollTo = () => {};
    } });
  const w = dom.window, d = w.document;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const ok = (c, msg) => { if (!c) errors.push('FALHOU: ' + msg); else console.log('ok  -', msg); };
  await wait(900);
  w.openMetadataModal('s1'); await wait(100);
  const btn = [...d.querySelectorAll('#modal-metadata button')].find((b) => /Buscar versões/.test(b.textContent));
  ok(!!btn, 'editor da faixa tem o botão "Buscar versões…"');
  btn.click(); await wait(300);
  const modal = d.getElementById('modal-versions');
  ok(modal && !modal.classList.contains('hidden'), 'abre o modal de versões');
  const body = d.getElementById('ver-body').innerHTML;
  ok(body.includes('Acústico MTV') && body.includes('(live)'), 'mostra a gravação ao vivo do MusicBrainz com álbum');
  ok(body.includes('&lt;ao vivo&gt;') && !body.includes('<ao vivo>'), 'título vindo da web é escapado');
  ok(body.includes('+12 s') && body.includes('-2 s'), 'diferença de duração em relação ao arquivo atual');
  ok(body.includes('href="https://www.youtube.com/watch?v=abc"'), 'link "abrir" para o vídeo');
  ok(d.getElementById('ver-sub').textContent.includes('04:10'), 'mostra a duração atual');
  d.querySelectorAll('#ver-body button')[0].click(); await wait(200);
  ok(confirms === 1, 'pede confirmação antes de trocar');
  ok(bodies.some((b) => b.includes('"mbid":"rec-live"')), 'envia a versão escolhida');
  ok(/Baixando/.test(d.getElementById('ver-status').textContent), 'mostra que está baixando');
  ok(d.querySelectorAll('#ver-body button[disabled]').length === 2, 'botões ficam desativados durante a troca');
  await wait(6800);
  ok(/Pronto/.test(d.getElementById('ver-status').textContent), 'acompanha o job até "Pronto"');
  if (errors.length) { console.log(errors.join('\n')); process.exit(1); }
  console.log('SEM ERROS');
  process.exit(0);
})();
