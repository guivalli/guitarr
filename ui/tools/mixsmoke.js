// Teste dos mixes locais (Feature 3): SmartRadio (proporções, Smart Shuffle, lote infinito) e Daylist.
// Uso: node mixsmoke.js ../../guitarr.html   (precisa de jsdom@24)
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync(process.argv[2], 'utf8');
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => { const m = e.detail || e.message; if (!/tailwind|getContext|navigation|media/i.test(String(m))) errors.push('jsdomError: ' + m); });
const GENRES = ['Rock', 'MPB', 'Jazz', 'Electronic', 'Pop', 'Ambient'];
const songs = [];
for (let i = 0; i < 180; i++) {
  songs.push({ id: 's' + i, title: 'Faixa ' + i, artist: 'Artista ' + (i % 15), album: 'Disco ' + (i % 30), albumId: 'al' + (i % 30), artistId: 'ar' + (i % 15),
    duration: 200, suffix: 'mp3', bitRate: 320, trackNumber: 1, path: 'M/' + i + '.mp3', genre: GENRES[i % 6],
    starred: i % 5 === 0, playCount: i % 3 === 0 ? (i % 40) + 1 : 0, createdAt: '2026-' + String(1 + (i % 9)).padStart(2, '0') + '-01', bpm: i % 6 === 3 ? 128 : 90 });
}
songs.push({ id: 'pod', title: 'Episódio', artist: 'Pod', album: 'Pod', albumId: 'alp', artistId: 'arp', duration: 3000, suffix: 'mp3', path: 'Seer/Podcasts/X/ep.mp3', starred: true, playCount: 99 });
async function fakeFetch(url, opt = {}) {
  const u = new URL(url, 'http://localhost/');
  const p = u.pathname;
  const json = (o, st = 200, h = {}) => ({ ok: st < 400, status: st, headers: { get: (k) => h[k.toLowerCase()] || null }, json: async () => o, text: async () => JSON.stringify(o) });
  if (p === '/api/song') return json(songs, 200, { 'x-total-count': String(songs.length) });
  if (p === '/api/album') return json([...new Set(songs.map((s) => s.albumId))].map((id) => ({ id, name: 'Disco ' + id, albumArtist: 'X', songCount: 6 })), 200, { 'x-total-count': '31' });
  if (p === '/api/artist') return json([], 200, { 'x-total-count': '0' });
  if (['/api/playlist', '/api/radio', '/api/missing'].includes(p)) return json([], 200, { 'x-total-count': '0' });
  if (p === '/api/seer/state') return json({});
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
      w.confirm = () => true; w.scrollTo = () => {};
    } });
  const w = dom.window, d = w.document;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const ok = (c, msg) => { if (!c) errors.push('FALHOU: ' + msg); else console.log('ok  -', msg); };
  await wait(900);
  const M = w.seerMixInternals;
  const view = () => d.getElementById('view-content').innerHTML;
  w.switchView('songs'); await wait(200);
  ok(view().indexOf('>SmartRadio<') > 0 && view().indexOf('Daylist') > 0, 'Home mostra SmartRadio e Daylist');
  const slotTitle = { manha: 'Café da Manhã Musical', tarde: 'Foco &amp; Ritmo da Tarde', noite: 'Sessão da Noite', madrugada: 'Madrugada Chill' }[M.slotNow()];
  ok(view().indexOf(slotTitle) > 0, 'Daylist do horário: ' + slotTitle);
  const nCards = d.querySelectorAll('.gt-card[onclick^="playDaylist("]').length; ok(nCards === 4, '4 cards de Daylist (' + nCards + ') ' + M.daylists().map(x => x.title).join(' | '));
  ok(M.slotNow(8) === 'manha' && M.slotNow(13) === 'tarde' && M.slotNow(20) === 'noite' && M.slotNow(2) === 'madrugada' && M.slotNow(23) === 'madrugada' && M.slotNow(5) === 'manha', 'faixas de horário');

  const tracks = () => M.getQueue().map((i) => w.eval('TRACKS')[i]);
  w.playSmartRadio('geral'); await wait(100);
  let q = tracks();
  ok(q.length === 30 && new Set(q.map((t) => t.id)).size === 30, 'SmartRadio gera 30 faixas sem repetir');
  ok(q.filter((t) => t.fav).length >= 12, 'Mix Geral: pelo menos 40% curtidas (' + q.filter((t) => t.fav).length + ')');
  ok(!q.some((t) => t.id === 'pod'), 'podcast fica fora');
  let clash = 0;
  for (let i = 0; i < q.length; i++) for (let k = 1; k <= 3 && i + k < q.length; k++) if (q[i].artist === q[i + k].artist) clash++;
  ok(clash === 0, 'Smart Shuffle: mesmo artista nunca a menos de 4 faixas (' + clash + ' choques)');
  const recent = JSON.parse(w.localStorage.getItem('seer_mix_recent'));
  ok(recent.length === 30, 'histórico anti-repetição guardado (' + recent.length + ')');

  // lote infinito: chegando nas 5 últimas, emenda mais 30
  const idxs = M.getQueue();
  w.eval('state').currentTrackIndex = idxs[26];
  w.nextTrack(); await wait(50);
  ok(M.getQueue().length === 60 && new Set(tracks().map((t) => t.id)).size === 60, 'SmartRadio renova com +30 diferentes nas últimas 5');
  ok(JSON.parse(w.localStorage.getItem('seer_mix_recent')).length === 50, 'histórico fica nas últimas 50');

  // humor
  w.setSmartRadioMode('energia'); await wait(50);
  q = tracks();
  ok(q.every((t) => /rock|electr/i.test(t.genres) || t.bpm >= 120), 'Energia só traz rock/eletrônica ou BPM alto');
  w.setSmartRadioMode('relax'); await wait(50);
  ok(tracks().every((t) => /jazz|ambient|mpb/i.test(t.genres) || (t.bpm > 0 && t.bpm < 100)), 'Relax traz jazz/ambient/MPB ou BPM baixo');
  w.setSmartRadioMode('descoberta'); await wait(50);
  ok(tracks().filter((t) => !t.plays).length >= 25, 'Descoberta prioriza as nunca tocadas');

  // Daylist estável até "Atualizar Mix"
  w.switchView('songs'); await wait(100);
  const before = M.daylists()[0].tracks.map((t) => t.id).join();
  const cardsBefore = [...d.querySelectorAll('[onclick^="playDaylist("].gt-card img')].map((i) => i.src).join();
  w.playDaylist(0); await wait(100);
  w.switchView('songs'); await wait(100);
  const cardsAfter = [...d.querySelectorAll('[onclick^="playDaylist("].gt-card img')].map((i) => i.src).join();
  ok(cardsBefore === cardsAfter, 'tocar uma Daylist não embaralha os cards');
  ok(M.getQueue().length === 30, 'Daylist toca 30 faixas');
  w.refreshMixes(); await wait(100);
  ok(M.daylists()[0].tracks.map((t) => t.id).join() !== before, '"Atualizar Mix" traz outra seleção');
  if (errors.length) { console.log(errors.join('\n')); process.exit(1); }
  console.log('SEM ERROS');
  process.exit(0);
})();
