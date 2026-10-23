'use strict';
/* Ponte com o Android (só no APK/Capacitor): controles na tela de bloqueio e notificação, botão voltar. */
(function () {
  var S = window.S, Cap = window.Capacitor;
  if (!(Cap && Cap.isNativePlatform && Cap.isNativePlatform())) return;
  var P = Cap.Plugins || {}, N = P.SeerNative, App = P.App;
  document.documentElement.classList.add('native');

  // ---- notificação de mídia + sessão (tela de bloqueio, fone, Bluetooth, carro)
  var lastSig = '', lastPos = -1;
  function artFor(t) {
    if (!t) return '';
    if (t.cover) return t.cover;
    var id = t.albumId || ('mf-' + t.id);
    var u = S.coverUrl(id, 512);
    // capa guardada no aparelho: o Android lê o arquivo direto
    if (S.off && S.off.baseUri && S.off.covers && S.off.covers[t.albumId]) return S.off.baseUri + '/covers/' + t.albumId + '.jpg';
    return /^https?:/.test(u) ? u : '';
  }
  function sync(force) {
    if (!N) return;
    var t = S.cur();
    if (!t) { if (lastSig) { lastSig = ''; N.mediaStop().catch(function () {}); } return; }
    var sig = [t.id, S.playing ? 1 : 0, Math.round(S.dur || t.duration || 0)].join('|');
    if (!force && sig === lastSig) return;
    lastSig = sig;
    N.mediaUpdate({ title: t.title || '', artist: t.artist || '', album: t.album || '', art: artFor(t),
      playing: !!S.playing, position: Math.round((S.pos || 0) * 1000), duration: Math.round((S.dur || t.duration || 0) * 1000) }).catch(function () {});
  }
  var paint0 = S.paint;
  S.paint = function () { var r = paint0.apply(this, arguments); try { sync(false); } catch (e) {} return r; };
  var seek0 = S.seek;
  S.seek = function (sec) { var r = seek0.apply(this, arguments); try { sync(true); } catch (e) {} return r; };

  function bind() {
  if (N) {
    N.addListener('mediaAction', function (ev) {
      var a = ev && ev.action;
      if (a === 'play') { if (!S.playing) S.togglePlay(); }
      else if (a === 'pause') { if (S.playing) S.togglePlay(); }
      else if (a === 'toggle') S.togglePlay();
      else if (a === 'next') S.next(false);
      else if (a === 'previous') S.prev();
      else if (a === 'seek' && ev.position != null) S.seek(Number(ev.position) / 1000);
    });
  }

  // ---- botão voltar do Android: fecha folha/player/tela antes de sair; na raiz, minimiza (a música continua)
  if (App) {
    App.addListener('backButton', function (ev) {
      if (S.handleBack && S.handleBack()) return;
      if (S.tab !== 'home') { S.go('home'); return; }
      App.minimizeApp();
    });
    App.addListener('appStateChange', function (ev) {
      if (ev && ev.isActive) { try { S.paint(); } catch (e) {} if (S.offlinePump) S.offlinePump(); }
    });
  }
  }
  // O Capacitor zera os listeners quando a página termina de carregar (onPageStarted chega depois do
  // script inline): registrar cedo demais perde os comandos da notificação. Registra depois do load.
  if (document.readyState === 'complete') setTimeout(bind, 800);
  else window.addEventListener('load', function () { setTimeout(bind, 800); });
})();
