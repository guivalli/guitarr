// Prints das telas principais em cada tema (escuro, OLED, claro), com uma API fictícia.
// Uso (no servidor): docker run --rm --ipc=host -v /tmp/pw:/pw -v $PWD:/p -w /pw mcr.microsoft.com/playwright:v1.49.1-noble \
//   node /p/ui/tools/themeshots.js /p/guitarr.html /p/NotInGit/shots
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
const artists = [0, 1, 2].map((i) => ({ id: 'ar' + i, name: ['Legião Urbana', 'Charlie Brown Jr.', 'Tom Jobim'][i], albumCount: 1, songCount: 8 }));

// capa de mentira: um PNG 1x1 colorido
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkqP9fDwAEhAH4mG2u0gAAAABJRU5ErkJggg==', 'base64');

async function route(r) {
  const u = new URL(r.request().url());
  const p = u.pathname;
  const json = (o, h = {}) => r.fulfill({ status: 200, contentType: 'application/json', headers: h, body: JSON.stringify(o) });
  if (p === '/app/' || p === '/app/index.html') return r.fulfill({ status: 200, contentType: 'text/html', body: html });
  if (p === '/api/song') return json(songs, { 'x-total-count': String(songs.length) });
  if (p === '/api/album') return json(albums, { 'x-total-count': '3' });
  if (p === '/api/artist') return json(artists, { 'x-total-count': '3' });
  if (['/api/playlist', '/api/radio', '/api/missing'].includes(p)) return json([], { 'x-total-count': '0' });
  if (p === '/api/seer/state') return json({ tour: { done: true } });
  if (p === '/api/seer/settings') return json({ autoApprove: true });
  if (p === '/api/seer/config') return json({ effective: {}, overrides: {}, secrets: {}, slskdConfig: true });
  if (p === '/api/seer/storage') return json({ usedBytes: 52e9, freeBytes: 400e9, totalBytes: 1e12, limitBytes: 0 });
  if (p === '/api/seer/requests') return json([{ id: 'r1', kind: 'album', title: 'Acústico MTV', artist: 'Charlie Brown Jr.', status: 'downloading', createdAt: '2026-10-22' }]);
  if (p.startsWith('/api/seer/')) return json([]);
  if (p.startsWith('/rest/getCoverArt')) return r.fulfill({ status: 200, contentType: 'image/png', body: png });
  if (p.startsWith('/rest/')) return json({ 'subsonic-response': { status: 'ok' } });
  if (u.hostname === 'localhost') return r.fulfill({ status: 404, body: '' });
  return r.continue();
}

(async () => {
  const browser = await chromium.launch();
  for (const theme of ['dark', 'oled', 'light']) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript((t) => {
      localStorage.setItem('nd_seer_pro_auth', JSON.stringify({ token: 'T', username: 'user', name: 'User', isAdmin: true, salt: 's', subToken: 't', id: 'u1' }));
      localStorage.setItem('seer_tour_done', '1');
      localStorage.setItem('seer_theme', t);
    }, theme);
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    await page.route('**/*', route);
    await page.goto('http://localhost/app/');
    await page.waitForTimeout(2500);
    const shot = (n) => page.screenshot({ path: `${outDir}/${theme}-${n}.png` });
    await shot('1-home');
    await page.evaluate(() => window.switchView('songs')); await page.waitForTimeout(500); await shot('2-songs');
    await page.evaluate(() => window.switchView('albums')); await page.waitForTimeout(500); await shot('3-albums');
    await page.evaluate(() => window.openArtistByName && window.openArtistByName('Legião Urbana')); await page.waitForTimeout(800); await shot('4-artist');
    await page.evaluate(() => window.switchView('cfg')); await page.waitForTimeout(800); await shot('5-cfg');
    await page.click('[onclick^="openServerModal"]'); await page.waitForTimeout(300); await shot('6-menu');
    await page.keyboard.press('Escape'); await page.mouse.click(700, 500);
    await page.evaluate(() => window.openMetadataModal('s0')); await page.waitForTimeout(300); await shot('7-edit');
    await page.evaluate(() => window.closeModal('modal-metadata'));
    await page.evaluate(() => window.openRequestsModal ? window.openRequestsModal() : window.switchView('seer')); await page.waitForTimeout(600); await shot('8-requests');
    console.log(theme, errs.length ? 'ERROS: ' + errs.join(' | ') : 'sem erros de página');
    await ctx.close();
  }
  await browser.close();
})();
