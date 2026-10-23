// Prints do app mobile (/app/mobile) em cada tema, com a mesma API fictícia do themeshots.js.
// Uso (no servidor): docker run --rm --ipc=host -v /tmp/pw:/pw -v $PWD:/p -w /pw mcr.microsoft.com/playwright:v1.49.1-noble \
//   node /p/ui/tools/mobileshots.js /p/apps/mobile/index.html /p/NotInGit/shots
const { chromium } = require('/pw/node_modules/playwright');
const fs = require('fs');
const [, , htmlPath, outDir] = process.argv;
const html = fs.readFileSync(htmlPath, 'utf8');
fs.mkdirSync(outDir, { recursive: true });

const genres = ['Rock', 'MPB', 'Samba', 'Pop', 'Jazz'];
const songs = Array.from({ length: 24 }, (_, i) => ({
  id: 's' + i, title: ['Tempo Perdido', 'Zóio de Lula', 'Garota de Ipanema', 'Ainda é Cedo', 'Pais e Filhos', 'Céu Azul'][i % 6] + (i > 5 ? ' ' + i : ''),
  artist: ['Legião Urbana', 'Charlie Brown Jr.', 'Tom Jobim'][i % 3], album: ['Dois', 'Preço Curto', 'Wave'][i % 3], albumId: 'al' + (i % 3), artistId: 'ar' + (i % 3),
  duration: 180 + i * 7, suffix: i % 2 ? 'flac' : 'mp3', bitRate: i % 2 ? 900 : 320, trackNumber: (i % 8) + 1, year: 1986 + (i % 3) * 10,
  path: 'x/' + i + '.mp3', createdAt: '2026-10-0' + ((i % 9) + 1), playCount: i * 3, starred: i % 4 === 0, genre: genres[i % 5],
}));
const albums = [0, 1, 2].map((i) => ({ id: 'al' + i, name: ['Dois', 'Preço Curto', 'Wave'][i], albumArtist: ['Legião Urbana', 'Charlie Brown Jr.', 'Tom Jobim'][i],
  albumArtistId: 'ar' + i, songCount: 8, maxYear: 1986 + i * 10, dominantColor: ['#5b3bff', '#e0563b', '#2fa36b'][i] }));
const artists = [0, 1, 2].map((i) => ({ id: 'ar' + i, name: ['Legião Urbana', 'Charlie Brown Jr.', 'Tom Jobim'][i], albumCount: 1, songCount: 8, mbzArtistId: i ? '' : 'mbA' }));

// capa de mentira: um PNG 1x1 colorido
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkqP9fDwAEhAH4mG2u0gAAAABJRU5ErkJggg==', 'base64');

async function route(r) {
  const u = new URL(r.request().url());
  const p = u.pathname;
  const json = (o, h = {}) => r.fulfill({ status: 200, contentType: 'application/json', headers: h, body: JSON.stringify(o) });
  if (p === '/app/mobile/' || p === '/app/mobile/index.html') return r.fulfill({ status: 200, contentType: 'text/html', body: html });
  if (p === '/api/song') return json(songs, { 'x-total-count': String(songs.length) });
  if (p === '/api/album') return json(albums, { 'x-total-count': '3' });
  if (p === '/api/artist') return json(artists, { 'x-total-count': '3' });
  if (['/api/playlist', '/api/radio', '/api/missing'].includes(p)) return json([], { 'x-total-count': '0' });
  if (p === '/api/seer/state') return json({ tour: { done: true } });
  if (p === '/api/seer/settings') return json({ autoApprove: true });
  if (p === '/api/seer/config') return json({ effective: {}, overrides: {}, secrets: {}, slskdConfig: true });
  if (p === '/api/seer/storage') return json({ usedBytes: 52e9, freeBytes: 400e9, totalBytes: 1e12, limitBytes: 0 });
  if (p === '/api/seer/requests') return json([{ id: 'r1', kind: 'album', title: 'Acústico MTV', artist: 'Charlie Brown Jr.', status: 'downloading', createdAt: '2026-10-22' }]);
  if (p === '/api/seer/catalog/artist/mbA') return json({ albums: [{ kind: 'album', mbid: 'rgx', title: 'Dois', year: 1986, type: 'Album' }, { kind: 'album', mbid: 'rgy', title: 'Que País É Este', year: 1987, type: 'Album' }, { kind: 'album', mbid: 'rgz', title: 'As Quatro Estações', year: 1989, type: 'Album' }] });
  if (/lrclib$/.test(p)) return json([{ duration: 180, synced: '[00:00.00] Todos os dias quando acordo\n[00:04.00] Não tenho mais\n[00:08.00] O tempo que passou\n[00:12.00] Mas tenho muito tempo\n[00:16.00] Temos todo o tempo do mundo' }]);
  if (p.startsWith('/api/seer/')) return json([]);
  if (p.startsWith('/rest/getCoverArt')) return r.fulfill({ status: 200, contentType: 'image/png', body: png });
  if (p.startsWith('/rest/')) return json({ 'subsonic-response': { status: 'ok' } });
  if (u.hostname === 'localhost') return r.fulfill({ status: 404, body: '' });
  return r.continue();
}

(async () => {
  const browser = await chromium.launch();
  for (const theme of ['dark', 'oled', 'light']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await ctx.addInitScript((t) => {
      localStorage.setItem('nd_seer_pro_auth', JSON.stringify({ token: 'T', username: 'user', name: 'User', isAdmin: true, salt: 's', subToken: 't', id: 'u1' }));
      localStorage.setItem('seer_theme', t);
    }, theme);
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    await page.route('**/*', route);
    await page.goto('http://localhost/app/mobile/');
    await page.waitForTimeout(1500);
    const shot = (n) => page.screenshot({ path: `${outDir}/m-${theme}-${n}.png` });
    await shot('1-home');
    await page.evaluate(() => document.getElementById('view').scrollTo(0, 700)); await page.waitForTimeout(200); await shot('2-home-list');
    await page.evaluate(() => { S.go('library'); S.libSeg = 'artists'; S.render(); }); await page.waitForTimeout(200);
    await page.click('[data-act="artist"][data-id="ar0"]'); await page.waitForTimeout(800); await shot('3-artist');
    await page.evaluate(() => S.playList([S.byId.s0], 0)); await page.waitForTimeout(600);
    await page.click('[data-act="np-open"]'); await page.waitForTimeout(600);
    await page.evaluate(() => document.getElementById('np').scrollTo(0, 400)); await page.waitForTimeout(200); await shot('4-player');
    await page.click('[data-act="lyr-full"]'); await page.waitForTimeout(400); await shot('5-lyrics');
    await page.evaluate(() => { S.handleBack(); S.handleBack(); S.go('car'); }); await page.waitForTimeout(400); await shot('6-car');
    await page.evaluate(() => S.go('seer')); await page.waitForTimeout(400); await shot('7-seer');
    console.log(theme, errs.length ? 'ERROS: ' + errs.join(' | ') : 'sem erros de página');
    await ctx.close();
  }
  await browser.close();
})();
