// Teste do Organizar Metadados / editor de tags: ignorar, corrigir/enviar capa e códigos MusicBrainz.
// Uso: node metasmoke2.js ../../guitarr.html   (precisa de jsdom@24)
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync(process.argv[2], 'utf8');
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => { const m = e.detail || e.message; if (!/tailwind|getContext/.test(String(m))) errors.push('jsdomError: ' + m); });
const calls = [], bodies = [];
let savedState = {};
const UUID = '484a2a59-4b01-444a-b0f6-15d902c4d4fb', GROUP = 'cae3de6c-3965-3c7c-be6b-a2dc61879893';
const songs = [1, 2].map((i) => ({ id: 's' + i, title: 'Faixa ' + i, artist: 'Banda', album: 'Disco', albumId: 'alb1', artistId: 'ar1', duration: 100, suffix: 'flac', bitRate: 900,
  trackNumber: i, path: 'Seer/Banda/Disco/' + i + '.flac', mbzAlbumId: '', mbzReleaseGroupId: '' }));
async function fakeFetch(url, opt = {}) {
  const u = new URL(url, 'http://localhost/');
  const p = u.pathname, m = (opt.method || 'GET').toUpperCase();
  const json = (o, st = 200, h = {}) => ({ ok: st < 400, status: st, headers: { get: (k) => h[k.toLowerCase()] || null }, json: async () => o, text: async () => JSON.stringify(o), blob: async () => new Blob(['x']) });
  if (m !== 'GET' || p.startsWith('/api/seer')) calls.push(m + ' ' + p);
  if (m !== 'GET' && opt.body) bodies.push(typeof opt.body === 'string' ? opt.body : '[arquivo]');
  if (p === '/api/seer/state') { if (m === 'PUT') { Object.assign(savedState, JSON.parse(opt.body)); return json(savedState); } return json(savedState); }
  if (m === 'PUT' && p.startsWith('/api/seer/library/album/') && p.endsWith('/cover')) return json({ albumId: 'x', found: true, source: 'manual' });
  if (m === 'POST' && p.endsWith('/cover')) return json({ albumId: 'x', refreshed: p.includes('alb3'), found: false });
  if (m === 'PUT' && p.startsWith('/api/seer/library/')) return json({ id: 'x', albumId: 'alb1' });
  if (p === '/api/missing') return json([], 200, { 'x-total-count': '0' });
  if (p === '/api/seer/library/metadata-report') return json({ songs: 2, songsWithAlbumMbid: 0, albumGroups: [], artistGroups: [], unknown: [],
    noMbid: [{ id: 'alb1', name: 'Disco', artist: 'Banda', songs: 2 }, { id: 'alb2', name: 'Bootleg', artist: 'X', songs: 3 }],
    noCover: [{ id: 'alb3', name: 'Velha', artist: 'Y', songs: 4, stale: true }, { id: 'alb4', name: 'Sem Arte', artist: 'Z', songs: 1 }], noCoverTotal: 2 });
  if (p === '/api/song') return json(songs, 200, { 'x-total-count': '2' });
  if (p === '/api/album') return json([{ id: 'alb1', name: 'Disco', albumArtist: 'Banda', albumArtistId: 'ar1', songCount: 2 }], 200, { 'x-total-count': '1' });
  if (p === '/api/artist') return json([{ id: 'ar1', name: 'Banda', albumCount: 1, songCount: 2 }], 200, { 'x-total-count': '1' });
  if (['/api/playlist', '/api/radio'].includes(p)) return json([], 200, { 'x-total-count': '0' });
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
      w.confirm = () => true; w.scrollTo = () => {};
    } });
  const w = dom.window, d = w.document;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const ok = (c, msg) => { if (!c) errors.push('FALHOU: ' + msg); else console.log('ok  -', msg); };
  const view = () => d.getElementById('view-content').innerHTML;
  await wait(800);
  d.getElementById('nav-meta').click(); await wait(600);

  // --- capas
  ok(view().indexOf('Álbuns sem capa (2)') > 0, 'lista 2 álbuns sem capa');
  ok(view().indexOf('caminho velho') > 0 && view().indexOf('>Corrigir<') > 0, 'capa velha mostra aviso e botão "Corrigir"');
  ok(view().indexOf('Enviar capa') > 0, 'cada linha tem "Enviar capa"');
  w.metaFetchCover(0); await wait(300);
  ok(calls.includes('POST /api/seer/library/album/alb3/cover'), 'Corrigir chama o endpoint de capa do álbum certo');
  const file = new w.File(['x'], 'c.jpg', { type: 'image/jpeg' });
  const inp = d.createElement('input'); Object.defineProperty(inp, 'files', { value: [file] });
  await w.metaUploadCover(1, inp); await wait(300);
  ok(calls.includes('PUT /api/seer/library/album/alb4/cover'), 'Enviar capa faz PUT no álbum certo');

  // --- ignorar
  w.metaIgnore('noMbid', 'alb2'); await wait(200);
  ok(view().indexOf('Álbuns sem código MusicBrainz (1)') > 0, 'ignorar tira o álbum da contagem');
  ok(JSON.stringify(savedState.metaIgnore) === '{"noMbid":["alb2"],"noCover":[]}', 'ignorados gravados no servidor: ' + JSON.stringify(savedState.metaIgnore));
  ok(view().indexOf('Ignorados (1)') > 0, 'aparece o bloco "Ignorados (1)"');
  w.metaToggleIgnored(); await wait(100);
  ok(view().indexOf('Restaurar') > 0, 'abrir ignorados mostra "Restaurar"');
  w.metaUnignore('noMbid', 'alb2'); await wait(200);
  ok(view().indexOf('Álbuns sem código MusicBrainz (2)') > 0, 'restaurar devolve à lista');
  w.metaIgnore('noCover', 'alb4'); await wait(200);
  ok(view().indexOf('Álbuns sem capa (1)') > 0, 'ignorar também vale para capas');

  // --- editor de tags: códigos MusicBrainz
  w.openMetadataModalForAlbum('alb1'); await wait(100);
  ok(!d.getElementById('modal-metadata').classList.contains('hidden'), 'Editar abre o modal');
  ok(d.getElementById('meta-mbz-album') && d.getElementById('meta-cover-file'), 'modal tem campos de código e envio de capa');
  d.getElementById('meta-mbz-album').value = 'https://musicbrainz.org/release/' + UUID;
  d.getElementById('meta-mbz-group').value = GROUP.toUpperCase();
  const before = bodies.length;
  await w.saveMetadataForm({ preventDefault() {} }); await wait(300);
  const songBody = JSON.parse(bodies.slice(before).find((b) => b.indexOf('"title"') > 0) || '{}');
  ok(songBody.mbzAlbumId === UUID && songBody.mbzReleaseGroupId === GROUP, 'link/UUID viram códigos limpos na faixa');
  ok(calls.filter((c) => c === 'PUT /api/seer/library/album/alb1').length === 1, 'aplica os códigos ao álbum inteiro');
  const albumBody = JSON.parse(bodies.slice(before).find((b) => b.indexOf('"title"') < 0 && b.indexOf('mbzAlbumId') > 0) || '{}');
  ok(albumBody.mbzAlbumId === UUID && !('title' in albumBody), 'o PUT do álbum só leva os códigos');

  w.openMetadataModalForAlbum('alb1'); await wait(100);
  d.getElementById('meta-mbz-album').value = 'lixo';
  const n = calls.length;
  await w.saveMetadataForm({ preventDefault() {} }); await wait(200);
  ok(calls.length === n, 'código inválido não envia nada');

  console.log(errors.length ? errors.join('\n') : 'SEM ERROS');
  process.exit(errors.length ? 1 : 0);
})();
