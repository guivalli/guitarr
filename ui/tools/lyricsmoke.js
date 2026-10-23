// Teste das letras (Feature 2): servidor -> LRCLIB, karaokê, pular pela letra, tela cheia, editor e lote.
// Uso: node lyricsmoke.js ../../guitarr.html   (precisa de jsdom@24)
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync(process.argv[2], 'utf8');
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => { const m = e.detail || e.message; if (!/tailwind|getContext|navigation|media/i.test(String(m))) errors.push('jsdomError: ' + m); });
const calls = [], bodies = [];
const songs = [1, 2].map((i) => ({ id: 's' + i, title: 'Faixa ' + i, artist: 'Banda', album: 'Disco', albumId: 'alb1', artistId: 'ar1', duration: 200, suffix: 'flac', bitRate: 900,
  trackNumber: i, path: 'Banda/Disco/' + i + '.flac' }));
let batch = { running: false, total: 0, done: 0, synced: 0, plain: 0, notFound: 0, failed: 0 };
async function fakeFetch(url, opt = {}) {
  const u = new URL(url, 'http://localhost/');
  const p = u.pathname, m = (opt.method || 'GET').toUpperCase();
  const json = (o, st = 200, h = {}) => ({ ok: st < 400, status: st, headers: { get: (k) => h[k.toLowerCase()] || null }, json: async () => o, text: async () => JSON.stringify(o) });
  calls.push(m + ' ' + p + (p.startsWith('/rest/') ? '?id=' + u.searchParams.get('id') : ''));
  if (m !== 'GET' && opt.body) bodies.push(typeof opt.body === 'string' ? opt.body : '[form]');
  if (p === '/rest/getLyricsBySongId') {
    const id = u.searchParams.get('id');
    const list = id === 's2' ? [{ synced: true, line: [{ start: 0, value: 'nativa 1' }, { start: 5000, value: 'nativa 2' }] }] : [];
    return json({ 'subsonic-response': { status: 'ok', lyricsList: { structuredLyrics: list } } });
  }
  if (p === '/api/seer/lyrics/s1/lrclib') return json([
    { id: 9, title: 'Faixa 1', artist: 'Banda', duration: 260, synced: '[00:00.50] longe' },
    { id: 7, title: 'Faixa 1', artist: 'Banda', duration: 201, synced: '[offset:0]\n[00:01.00] primeira\n[00:10.00][00:30.00] refrão\n[00:20.00] segunda' }]);
  if (p.startsWith('/api/seer/lyrics/') && m === 'PUT') return json(null, 204);
  if (p === '/api/seer/lyrics-batch') { if (m === 'POST') batch = { running: true, total: 4, done: 1, synced: 1, plain: 0, notFound: 0, failed: 0 }; return json(batch, m === 'POST' ? 202 : 200); }
  if (p === '/api/seer/state') return json({});
  if (p === '/api/seer/library/metadata-report') return json({ songs: 2, songsWithAlbumMbid: 0, albumGroups: [], artistGroups: [], unknown: [], noMbid: [], noCover: [], noCoverTotal: 0 });
  if (p === '/api/song') return json(songs, 200, { 'x-total-count': '2' });
  if (p === '/api/album') return json([{ id: 'alb1', name: 'Disco', albumArtist: 'Banda', albumArtistId: 'ar1', songCount: 2, dominantColor: '#aa3355' }], 200, { 'x-total-count': '1' });
  if (p === '/api/artist') return json([{ id: 'ar1', name: 'Banda', albumCount: 1, songCount: 2 }], 200, { 'x-total-count': '1' });
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
      w.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
      w.HTMLMediaElement.prototype.pause = function () {};
      w.HTMLElement.prototype.scrollTo = function () {};
      w.HTMLElement.prototype.scrollIntoView = function () {};
      w.confirm = () => true; w.scrollTo = () => {};
    } });
  const w = dom.window, d = w.document;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const ok = (c, msg) => { if (!c) errors.push('FALHOU: ' + msg); else console.log('ok  -', msg); };
  const panel = () => d.getElementById('np-lyrics').innerHTML;
  await wait(900);
  // o <audio> do live.js não é exposto: pega pelo protótipo
  let audioEl = null;
  const origPlay = w.HTMLMediaElement.prototype.play;
  w.HTMLMediaElement.prototype.play = function () { audioEl = this; return origPlay.call(this); };
  w.playTrackByIndex(w.eval('TRACKS.findIndex(t => t.id === "s1")')); await wait(500);
  ok(calls.includes('GET /rest/getLyricsBySongId?id=s1'), 'pergunta primeiro ao servidor');
  ok(calls.includes('GET /api/seer/lyrics/s1/lrclib'), 'sem letra no servidor, cai no LRCLIB');
  ok(panel().indexOf('primeira') > 0 && panel().indexOf('longe') < 0, 'usa o candidato com a mesma duração, não o de 260 s');
  ok((panel().match(/refrão/g) || []).length === 2, 'linha com dois tempos aparece duas vezes');
  ok(d.getElementById('np-lyrics-source').textContent.indexOf('LRCLIB') >= 0, 'mostra a fonte LRCLIB');
  ok(audioEl, 'achou o elemento de áudio');
  Object.defineProperty(audioEl, 'currentTime', { configurable: true, writable: true, value: 12 });
  audioEl.dispatchEvent(new w.Event('timeupdate')); await wait(50);
  const on = d.querySelector('#np-lyrics .lyr-on');
  ok(on && on.textContent === 'refrão', 'linha ativa aos 12 s é o refrão: ' + (on && on.textContent));
  ok(on && on.className.indexOf('scale-105') >= 0 && on.className.indexOf('opacity-40') < 0, 'linha ativa em destaque, sem blur');
  w.lyricsSeek(2); await wait(50);
  ok(audioEl.currentTime === 20, 'clicar na linha pula para 00:20: ' + audioEl.currentTime);
  w.openLyricsFull(); await wait(100);
  const full = d.getElementById('lyrics-full');
  ok(full && full.style.display !== 'none' && full.innerHTML.indexOf('segunda') > 0, 'tela cheia mostra a letra');
  ok(full.style.background.indexOf('170, 51, 85') >= 0 || full.style.background.indexOf('#aa3355') >= 0 || full.style.background.indexOf('rgba(170') >= 0, 'tela cheia usa a cor do álbum: ' + full.style.background.slice(0, 60));
  ok(full.querySelector('#lyrics-full-lines .lyr-on'), 'linha ativa também na tela cheia');
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' })); await wait(50);
  ok(full.style.display === 'none', 'Esc fecha a tela cheia');

  // editor manual
  w.openLyricsEditor(); await wait(50);
  const ta = d.getElementById('lyrics-editor-text');
  ok(ta && ta.value.indexOf('[00:01.00] primeira') >= 0, 'editor abre com a letra atual');
  ta.value = 'verso um\nverso dois';
  await w.lyricsSave(false); await wait(300);
  ok(calls.includes('PUT /api/seer/lyrics/s1') && bodies.some((b) => b === '{"synced":"","plain":"verso um\\nverso dois"}'), 'texto sem tempo é salvo como texto: ' + bodies[bodies.length - 1]);
  w.openLyricsEditor(); await wait(50);
  d.getElementById('lyrics-editor-text').value = '[00:02.00] colado';
  await w.lyricsSave(false); await wait(300);
  ok(bodies.some((b) => b === '{"synced":"[00:02.00] colado","plain":""}'), 'LRC colado é salvo como sincronizado');

  // faixa com letra nativa sincronizada não consulta o LRCLIB
  w.playTrackByIndex(w.eval('TRACKS.findIndex(t => t.id === "s2")')); await wait(400);
  ok(panel().indexOf('nativa 2') > 0 && !calls.includes('GET /api/seer/lyrics/s2/lrclib'), 'letra sincronizada do arquivo dispensa o LRCLIB');

  // lote no Organizar Metadados
  d.getElementById('nav-meta').click(); await wait(500);
  ok(d.getElementById('lyrics-batch-card') && d.body.innerHTML.indexOf('Buscar Letras Faltantes (LRCLIB)') > 0, 'botão do lote em Organizar Metadados');
  await w.metaFetchLyrics(); await wait(300);
  ok(calls.includes('POST /api/seer/lyrics-batch') && d.getElementById('lyrics-batch-card').textContent.indexOf('1 de 4') > 0, 'lote mostra o progresso');
  if (errors.length) { console.log(errors.join('\n')); process.exit(1); }
  console.log('SEM ERROS');
  process.exit(0);
})();
