// Idiomas e busca com catálogo: inglês é o padrão, português (BR) vale quando escolhido, e a busca
// nas telas da biblioteca mostra o catálogo do MusicBrainz embaixo, só com o que falta.
// Uso: node i18nsmoke.js ../../guitarr.html   (precisa de jsdom@24)
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync(process.argv[2], 'utf8');
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => { const m = e.detail || e.message; if (!/tailwind|getContext/.test(String(m))) errors.push('jsdomError: ' + m); });
const calls = [];
const songs = [{ id: 's1', title: 'Tempo Perdido', artist: 'Legião Urbana', album: 'Dois', albumId: 'alb1', artistId: 'ar1', duration: 250,
  suffix: 'mp3', bitRate: 320, trackNumber: 1, path: 'LU/Dois/01.mp3', createdAt: '2026-01-01' }];
const catalog = [
  { kind: 'album', mbid: 'b1', title: 'Dois', artist: 'Legião Urbana', year: 1986, type: 'Album', inLibrary: true, libraryId: 'alb1' },
  { kind: 'album', mbid: 'b2', title: 'Acústico MTV', artist: 'Legião Urbana', year: 1999, type: 'Album + Live', coverId: 'c2' },
  { kind: 'track', mbid: 't1', title: 'Pais e Filhos', artist: 'Legião Urbana', album: 'Dois', year: 1986, durationMs: 308000 },
];
async function fakeFetch(url, opt = {}) {
  const u = new URL(url, 'http://localhost/');
  const p = u.pathname, m = (opt.method || 'GET').toUpperCase();
  const json = (o, st = 200, h = {}) => ({ ok: st < 400, status: st, headers: { get: (k) => h[k.toLowerCase()] || null }, json: async () => o, text: async () => JSON.stringify(o) });
  if (m !== 'GET' && p.startsWith('/api/seer')) calls.push(m + ' ' + p + ' ' + (opt.body || ''));
  if (p === '/auth/createAdmin' && m === 'POST') { calls.push('POST /auth/createAdmin ' + opt.body); return json({ ok: 1 }); }
  if (p === '/auth/login' && m === 'POST') return json({ token: 'T', username: 'boss', name: 'Boss', isAdmin: true, subsonicSalt: 's', subsonicToken: 't', id: 'u1' });
  if (p === '/api/user' && m === 'GET') return json([{ id: 'u1', userName: 'admin', isAdmin: true }, { id: 'u2', userName: 'maria', isAdmin: false }], 200, { 'x-total-count': '2' });
  if (p === '/api/user' && m === 'POST') { calls.push('POST /api/user ' + opt.body); return json({ id: 'u3' }); }
  if (p.startsWith('/api/user/') && m === 'DELETE') { calls.push('DELETE ' + p); return json({}); }
  if (p === '/api/seer/state') return json({});
  if (p === '/api/seer/catalog') return json(catalog);
  if (p === '/api/seer/requests' && m === 'POST') return json({ id: 'r1', kind: 'track', mbid: 't1', title: 'Pais e Filhos', artist: 'Legião Urbana', status: 'pending', createdAt: '2026-10-23' });
  if (p === '/api/song') return json(songs, 200, { 'x-total-count': '1' });
  if (p === '/api/album') return json([{ id: 'alb1', name: 'Dois', albumArtist: 'Legião Urbana', albumArtistId: 'ar1', songCount: 1 }], 200, { 'x-total-count': '1' });
  if (p === '/api/artist') return json([{ id: 'ar1', name: 'Legião Urbana', albumCount: 1, songCount: 1 }], 200, { 'x-total-count': '1' });
  if (['/api/playlist', '/api/radio', '/api/missing'].includes(p)) return json([], 200, { 'x-total-count': '0' });
  if (p.startsWith('/api/seer/')) return json([]);
  if (p.startsWith('/rest/')) return json({ 'subsonic-response': { status: 'ok' } });
  return json({}, 404);
}
function open(lang, opts = {}) {
  return new JSDOM(opts.html || html, { url: 'http://localhost/app/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.fetch = fakeFetch;
      if (!opts.anon) w.localStorage.setItem('nd_seer_pro_auth', JSON.stringify({ token: 'T', username: 'user', name: 'user', isAdmin: true, salt: 's', subToken: 't', id: 'u1' }));
      w.localStorage.setItem('seer_tour_done', '1');
      if (lang) w.localStorage.setItem('nd_seer_lang', lang);
      w.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
      w.HTMLMediaElement.prototype.pause = function () {};
      w.HTMLElement.prototype.scrollIntoView = function () {};
      w.scrollTo = () => {};
    } });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (c, msg) => { if (!c) errors.push('FALHOU: ' + msg); else console.log('ok  -', msg); };
(async () => {
  // padrão: inglês
  let dom = open(null), w = dom.window, d = w.document;
  await wait(1000);
  ok(w.seerLang() === 'en', 'sem escolha, o idioma é inglês');
  const nav = d.getElementById('nav-songs').textContent;
  ok(/Songs/.test(nav) && !/Músicas/.test(nav), 'menu lateral em inglês (' + nav.trim().replace(/\s+/g, ' ') + ')');
  ok(/Good (morning|afternoon|evening)/.test(d.getElementById('view-content').textContent), 'saudação da Home em inglês');
  ok(d.documentElement.lang === 'en', '<html lang> em inglês');

  // busca na tela Músicas: biblioteca primeiro, catálogo embaixo, só o que falta
  w.switchView('songs'); await wait(100);
  const inp = d.getElementById('global-search-input');
  inp.value = 'legi'; w.handleGlobalSearch('legi');
  await wait(900);
  const blk = d.getElementById('seer-cat-block');
  ok(!!blk, 'bloco do catálogo aparece abaixo dos resultados da biblioteca');
  const vc1 = d.getElementById('view-content');
  ok(vc1.firstElementChild !== blk && blk.previousElementSibling !== null, 'o bloco vem depois da lista da biblioteca');
  const btxt = blk.textContent;
  ok(/From the catalog/.test(btxt) && /Acústico MTV/.test(btxt) && /Pais e Filhos/.test(btxt), 'mostra os itens do catálogo (' + btxt.replace(/\s+/g, ' ').slice(0, 90) + '…)');
  const titles = [...blk.querySelectorAll('span.truncate')].map((x) => x.textContent);
  ok(titles.length >= 2 && !titles.includes('Dois'), 'não repete o que já está na biblioteca (' + titles.join(', ') + ')');
  const req = [...blk.querySelectorAll('button')].find((b) => /Request/.test(b.textContent));
  ok(!!req, 'botão "+ Request" em inglês');
  req.click(); await wait(300);
  ok(calls.some((c) => c.startsWith('POST /api/seer/requests') && c.includes('"mbid":"b2"')), 'pedir daqui envia o pedido ao servidor');

  // o seletor de idioma existe no menu da conta
  w.openServerModal({ currentTarget: d.querySelector('[onclick^="openServerModal"]') }); await wait(100);
  const menu = d.getElementById('seer-account-menu');
  ok(menu && /Language/.test(menu.textContent) && /Português \(BR\)/.test(menu.textContent), 'menu da conta tem o seletor de idioma');
  dom.window.close();

  // português escolhido: nada é traduzido
  dom = open('pt'); w = dom.window; d = w.document;
  await wait(1000);
  ok(w.seerLang() === 'pt', 'com pt guardado, o idioma é português');
  ok(/Músicas/.test(d.getElementById('nav-songs').textContent), 'menu lateral em português');
  w.switchView('songs'); await wait(100);
  d.getElementById('global-search-input').value = 'legi'; w.handleGlobalSearch('legi'); await wait(900);
  ok(/Do catálogo \(MusicBrainz\)/.test(d.getElementById('seer-cat-block').textContent), 'bloco do catálogo em português');

  // configurações: usuários (admin cria e remove)
  dom = open('en'); w = dom.window; d = w.document;
  await wait(1000);
  w.switchView('cfg'); await wait(600);
  const cfgTxt = d.getElementById('view-content').textContent;
  ok(/Users/.test(cfgTxt) && /maria/.test(cfgTxt) && /Add user/.test(cfgTxt), 'Configurações lista os usuários e tem "Add user"');
  d.getElementById('usr-name').value = 'joao'; d.getElementById('usr-pass').value = 'secret1'; d.getElementById('usr-admin').checked = true;
  w.usersAdd(); await wait(300);
  ok(calls.some((c) => c.startsWith('POST /api/user ') && c.includes('"userName":"joao"') && c.includes('"isAdmin":true')), 'cria o usuário pela API nativa');
  w.confirm = () => true; w.usersDelete('u2', 'maria'); await wait(200);
  ok(calls.includes('DELETE /api/user/u2'), 'remove o usuário pela API nativa');
  dom.window.close();

  // primeiro acesso: sem usuários, o servidor avisa (firstTime) e a tela de login vira "criar administrador"
  const firstHtml = html.replace('content="{{ .AppConfig }}"', 'content="{&quot;firstTime&quot;:true}"');
  ok(firstHtml !== html, 'a página tem o marcador {{ .AppConfig }} para o servidor preencher');
  dom = open('en', { html: firstHtml, anon: true }); w = dom.window; d = w.document;
  await wait(800);
  const lg = d.getElementById('seer-login');
  ok(lg && /Create the administrator account/.test(lg.textContent) && d.getElementById('seer-login-pass2'), 'primeiro acesso mostra "criar conta de administrador" com confirmação de senha');
  d.getElementById('seer-login-user').value = 'boss'; d.getElementById('seer-login-pass').value = 'abcdef'; d.getElementById('seer-login-pass2').value = 'abcxyz';
  d.getElementById('seer-login-form').dispatchEvent(new w.Event('submit', { cancelable: true })); await wait(200);
  ok(/do not match/.test(d.getElementById('seer-login-err').textContent), 'senhas diferentes são recusadas');
  d.getElementById('seer-login-pass2').value = 'abcdef';
  d.getElementById('seer-login-form').dispatchEvent(new w.Event('submit', { cancelable: true })); await wait(600);
  ok(calls.some((c) => c.startsWith('POST /auth/createAdmin') && c.includes('"username":"boss"')), 'envia POST /auth/createAdmin');
  ok(!d.getElementById('seer-login'), 'depois de criar, entra direto (a tela some)');
  dom.window.close();

  // servidor já com usuários: login normal, sem criar conta
  dom = open('en', { anon: true }); w = dom.window; d = w.document;
  await wait(800);
  ok(/Sign in to your account/.test(d.getElementById('seer-login').textContent) && !d.getElementById('seer-login-pass2'), 'login normal quando já existem usuários');
  dom.window.close();
  if (errors.length) { console.log(errors.join('\n')); process.exit(1); }
  console.log('SEM ERROS');
  process.exit(0);
})();
