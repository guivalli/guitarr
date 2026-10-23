'use strict';
/* Guitarr · app mobile. Mesma sessão e mesma API do site (/auth, /api, /rest, /api/seer). */
(function () {
  var AUTH_KEY = 'nd_seer_pro_auth';   // o mesmo do site: entrar em um vale para o outro
  var SERVER_KEY = 'nd_seer_server';   // só usado quando o app roda fora do servidor (Capacitor)
  var $ = function (id) { return document.getElementById(id); };
  var S = window.S = {
    auth: null, tracks: [], byId: {}, albums: [], artists: [], playlists: [], favs: {},
    tab: 'home', pages: [], filter: 'all', homeQ: '', homeLimit: 60, libSeg: 'albums',
    q: [], qi: 0, orig: null, playing: false, pos: 0, dur: 0, shuffle: false, repeat: 'off',
    offline: { ids: {}, meta: {} }, online: navigator.onLine, loaded: false,
    seer: { q: '', results: [], loading: false, error: '', requests: [], detail: null, lastStatus: {} },
    pod: { channels: [], episodes: {}, loading: false, error: '', q: '', src: 'all', results: [], searching: false, serr: '', adding: {} },
    storage: null, dups: null, lyrics: null
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function fmtDur(sec) { var s = Math.max(0, Math.round(sec || 0)); return pad2(Math.floor(s / 60)) + ':' + pad2(s % 60); }
  function fmtBytes(b) {
    b = Number(b) || 0;
    if (b >= 1e12) return (b / 1e12).toFixed(2) + ' TB';
    if (b >= 1e9) return (b / 1e9).toFixed(1) + ' GB';
    if (b >= 1e6) return (b / 1e6).toFixed(1) + ' MB';
    return Math.round(b / 1e3) + ' KB';
  }
  function errMsg(e) { return (e && e.message) ? e.message : 'erro desconhecido'; }
  var toastTimer;
  function toast(m) {
    var t = $('toast'); if (!t) return;
    t.textContent = m; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }
  function ls(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {}
    return null;
  }

  // ---------------------------------------------------------------- servidor ---
  // Servido pelo próprio Guitarr: caminhos relativos. Empacotado (capacitor/file): endereço digitado no login.
  function needsServer() { return !(/^https?:$/.test(location.protocol) && /^\/app(\/|$)/.test(location.pathname)); }
  function base() { return needsServer() ? (ls(SERVER_KEY) || '').replace(/\/+$/, '') : ''; }

  // -------------------------------------------------------------------- auth ---
  function loadAuth() {
    try { var a = JSON.parse(ls(AUTH_KEY)); if (a && a.token && a.salt) S.auth = a; } catch (e) {}
  }
  function saveAuth() { ls(AUTH_KEY, JSON.stringify(S.auth)); }
  function subQ() { var a = S.auth; return 'u=' + encodeURIComponent(a.username) + '&t=' + a.subToken + '&s=' + a.salt + '&v=1.16.1&c=SeerMobile'; }
  function coverUrl(id, size) { return base() + '/rest/getCoverArt?id=' + encodeURIComponent(id) + '&size=' + (size || 300) + '&' + subQ(); }
  function streamUrl(id) { return base() + '/rest/stream?id=' + encodeURIComponent(id) + '&' + subQ(); }
  function episodeUrl(id) { return base() + '/api/seer/podcasts/episodes/' + encodeURIComponent(id) + '/stream?jwt=' + encodeURIComponent(S.auth.token); }

  async function doLogin(username, password) {
    var r = await fetch(base() + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username, password: password }) });
    if (!r.ok) throw new Error(r.status === 401 ? 'Usuário ou senha incorretos' : 'Falha no login (' + r.status + ')');
    var d = await r.json();
    S.auth = { token: d.token, username: d.username, name: d.name || d.username, isAdmin: !!d.isAdmin,
      salt: d.subsonicSalt, subToken: d.subsonicToken, id: d.id };
    saveAuth();
  }

  // --------------------------------------------------------------------- api ---
  async function api(path, opt) {
    opt = opt || {};
    var h = { 'x-nd-authorization': 'Bearer ' + S.auth.token };
    var body;
    if (opt.json !== undefined) { h['Content-Type'] = 'application/json'; body = JSON.stringify(opt.json); }
    else if (opt.form !== undefined) body = opt.form; // FormData: o navegador põe o boundary
    var res = await fetch(base() + path, { method: opt.method || 'GET', headers: h, body: body, keepalive: !!opt.keepalive });
    var nt = res.headers.get('x-nd-authorization');
    if (nt && nt !== S.auth.token) { S.auth.token = nt; saveAuth(); }
    if (res.status === 401) { S.showLogin('Sessão expirada. Entre novamente.'); throw new Error('Não autorizado'); }
    if (!res.ok) {
      var txt = ''; try { txt = (await res.text()).trim(); } catch (e) {}
      var err = new Error(txt || ('HTTP ' + res.status)); err.status = res.status; throw err;
    }
    return res;
  }
  async function apiJson(path, opt) { var r = await api(path, opt); return r.status === 204 ? null : r.json(); }
  async function fetchAll(resource, sort) {
    var out = [], PAGE = 500, start = 0, total = Infinity;
    while (start < total) {
      var res = await api('/api/' + resource + '?_start=' + start + '&_end=' + (start + PAGE) + '&_sort=' + sort + '&_order=ASC');
      var arr = await res.json();
      var hdr = parseInt(res.headers.get('x-total-count') || '', 10);
      total = isNaN(hdr) ? (arr.length < PAGE ? start + arr.length : Infinity) : hdr;
      for (var i = 0; i < arr.length; i++) out.push(arr[i]);
      if (!arr.length) break;
      start += PAGE;
    }
    return out;
  }
  async function subsonic(method, params) {
    var q = Object.keys(params || {}).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
    var r = await fetch(base() + '/rest/' + method + '?' + q + '&f=json&' + subQ());
    var d = (await r.json())['subsonic-response'];
    if (!d || d.status !== 'ok') throw new Error((d && d.error && d.error.message) || 'erro Subsonic');
    return d;
  }

  // ------------------------------------------------------------------- ícones ---
  var I = {
    play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>',
    next: '<svg viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>',
    prev: '<svg viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>',
    shuffle: '<svg viewBox="0 0 24 24"><path d="M10.6 9.2L5.4 4 4 5.4l5.2 5.2 1.4-1.4zM14.5 4l2.0 2-12.5 12.6 1.4 1.4L17.9 7.4l2 2V4h-5.4zm.3 9.9l-1.4 1.4 3.1 3.1-2 2h5.4v-5.4l-2 2-3.1-3.1z"/></svg>',
    repeat: '<svg viewBox="0 0 24 24"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>',
    heart: '<svg viewBox="0 0 24 24"><path d="M12 21l-1.5-1.3C5.4 15.4 2 12.3 2 8.5 2 5.4 4.4 3 7.5 3c1.7 0 3.4.8 4.5 2.1C13.1 3.8 14.8 3 16.5 3 19.6 3 22 5.4 22 8.5c0 3.8-3.4 6.9-8.5 11.2L12 21z"/></svg>',
    heartOff: '<svg viewBox="0 0 24 24"><path d="M16.5 3c-1.7 0-3.4.8-4.5 2.1C10.9 3.8 9.2 3 7.5 3 4.4 3 2 5.4 2 8.5c0 3.8 3.4 6.9 8.5 11.2L12 21l1.5-1.3C18.6 15.4 22 12.3 22 8.5 22 5.4 19.6 3 16.5 3zm-4.4 15.6l-.1.1-.1-.1C7.1 14.2 4 11.4 4 8.5 4 6.5 5.5 5 7.5 5c1.5 0 3 1 3.6 2.4h1.8C13.5 6 15 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.9-3.1 5.7-7.9 10.1z"/></svg>',
    more: '<svg viewBox="0 0 24 24"><path d="M12 8a2 2 0 100-4 2 2 0 000 4zm0 2a2 2 0 100 4 2 2 0 000-4zm0 6a2 2 0 100 4 2 2 0 000-4z"/></svg>',
    back: '<svg viewBox="0 0 24 24"><path d="M15.4 7.4L14 6l-6 6 6 6 1.4-1.4L10.8 12z"/></svg>',
    down: '<svg viewBox="0 0 24 24"><path d="M7.4 8.6L12 13.2l4.6-4.6L18 10l-6 6-6-6z"/></svg>',
    search: '<svg viewBox="0 0 24 24"><path d="M15.5 14h-.8l-.3-.3A6.5 6.5 0 109.5 16a6.5 6.5 0 004.2-1.6l.3.3v.8l5 5 1.5-1.5-5-5zm-6 0a4.5 4.5 0 110-9 4.5 4.5 0 010 9z"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z"/></svg>'
  };

  Object.assign(S, { $: $, esc: esc, fmtDur: fmtDur, fmtBytes: fmtBytes, errMsg: errMsg, toast: toast, ls: ls, base: base,
    needsServer: needsServer, SERVER_KEY: SERVER_KEY, loadAuth: loadAuth, saveAuth: saveAuth, coverUrl: coverUrl,
    streamUrl: streamUrl, episodeUrl: episodeUrl, doLogin: doLogin, api: api, apiJson: apiJson, fetchAll: fetchAll,
    subsonic: subsonic, I: I, AUTH_KEY: AUTH_KEY });
})();
