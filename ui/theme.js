// Temas da interface web: escuro (o design original), preto OLED e claro.
// O mock usa cores fixas do Tailwind (bg-[#121212], text-white, bg-white/10...). Em vez de
// reescrever o HTML, cada tema remapeia essas classes por CSS sob html[data-theme=...].
// build.py troca o marcador abaixo pela lista de classes de cor do mock e do live.js e
// injeta este arquivo no <head>, para o tema valer antes do primeiro desenho.
// Dentro de .th-keep (login, letra em tela cheia) o tema claro não mexe: são telas sobre fundo escuro.
(function () {
  var CLASSES = /*@@COLOR_CLASSES@@*/[];
  var KEY = 'seer_theme';
  var NAMES = { dark: 'Escuro', oled: 'Preto (OLED)', light: 'Claro' };
  var SHORT = { dark: 'Escuro', oled: 'OLED', light: 'Claro' };
  var NAMED = { white: '#ffffff', black: '#000000', 'zinc-300': '#d4d4d8', 'zinc-400': '#a1a1aa', 'zinc-900': '#18181b',
    // tons claros da paleta do Tailwind usados como texto (avisos, erros): no tema claro viram tons escuros
    'red-200': '#fecaca', 'red-300': '#fca5a5', 'red-400': '#f87171', 'amber-300': '#fcd34d', 'amber-400': '#fbbf24',
    'purple-300': '#d8b4fe', 'purple-400': '#c084fc' };
  var RE = /^((?:hover|focus|group-hover):)?(bg|text|border|divide|from|via|to|placeholder)-(white|black|zinc-\d00|(?:red|amber|purple)-[234]00|\[#[0-9a-fA-F]{3,6}\])(?:\/(\d+|\[[0-9.]+\]))?$/;

  function rgb(h) {
    h = h.replace(/[\[\]#]/g, '');
    if (h.length === 3) h = h.replace(/./g, '$&$&');
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function toHsl(c) {
    var r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, h = 0, s = 0, d = mx - mn;
    if (d) {
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h *= 60;
    }
    return [h, s, l];
  }
  function css(h, s, l, a) {
    return 'hsla(' + Math.round(h) + ',' + Math.round(s * 100) + '%,' + Math.round(l * 1000) / 10 + '%,' + Math.round(a * 1000) / 1000 + ')';
  }
  function sel(c) { return '.' + c.replace(/([:\/\[\]#.%])/g, '\\$1'); }

  // Cor nova de uma classe no tema, ou null para manter a original.
  function light(util, c, a) {
    var hsl = toHsl(c), h = hsl[0], s = hsl[1], l = hsl[2];
    if (util === 'text' || util === 'placeholder') {
      if (l < 0.1) return null; // texto preto fica sobre botões azuis/brancos
      return css(h, s, Math.min(0.55, Math.max(0.1, 1 - l)), a);
    }
    if (util === 'bg') {
      if (s > 0.5 && l > 0.3 && l < 0.9) return null; // fundos coloridos (azul, vermelho...) ficam
      if (l < 0.25) {
        if (a >= 0.85 || (l >= 0.02 && a >= 0.5)) return l < 0.02 ? '#eceef2' : css(h, Math.min(s, 0.25), 1 - l * 0.3, a);
        if (a >= 0.7) return null; // preto translúcido: fundo de modal e selos sobre capas continuam escuros
        return 'rgba(0,0,0,' + Math.round(a * 150) / 1000 + ')';
      }
      if (l > 0.9 && s < 0.2) return a >= 0.99 ? '#18181d' : 'rgba(24,24,32,' + Math.round(Math.min(a * 0.8, 0.2) * 1000) / 1000 + ')';
      return null;
    }
    if (util === 'border' || util === 'divide') {
      if (l > 0.9) return 'rgba(0,0,0,' + Math.round(Math.min(0.25, Math.max(0.08, a)) * 1000) / 1000 + ')';
      return null;
    }
    if (l < 0.25 && a >= 0.85) return css(h, Math.min(s * 1.4, 0.6), 0.92, a); // degradês do topo
    return null;
  }
  function oled(util, c, a) {
    var hsl = toHsl(c), l = hsl[2];
    if ((util === 'bg' || util === 'from' || util === 'via' || util === 'to') && l < 0.25 && l > 0 && a >= 0.85) {
      return l < 0.09 ? css(0, 0, 0, a) : css(hsl[0], hsl[1], l * 0.5, a);
    }
    return null;
  }

  function rule(theme, cls, fn, keep) {
    var m = RE.exec(cls);
    if (!m) return '';
    var variant = m[1] || '', util = m[2], name = m[3], al = m[4];
    var a = al ? (al[0] === '[' ? parseFloat(al.slice(1, -1)) : parseInt(al, 10) / 100) : 1;
    var col = fn(util, rgb(NAMED[name] || name), a);
    if (!col) return '';
    var root = 'html[data-theme="' + theme + '"] ';
    var s = sel(cls), guard = keep ? ':not(.th-keep):not(.th-keep *)' : '';
    if (variant === 'hover:') s += ':hover';
    else if (variant === 'focus:') s += ':focus';
    else if (variant === 'group-hover:') s = '.group:hover ' + s;
    s += guard;
    if (util === 'placeholder') s += '::placeholder';
    var decl;
    switch (util) {
      case 'bg': decl = 'background-color:' + col; break;
      case 'text': case 'placeholder': decl = 'color:' + col; break;
      case 'border': decl = 'border-color:' + col; break;
      case 'divide': s += ' > :not([hidden]) ~ :not([hidden])'; decl = 'border-color:' + col; break;
      case 'from': decl = '--tw-gradient-from:' + col + ' var(--tw-gradient-from-position)!important;--tw-gradient-stops:var(--tw-gradient-from),var(--tw-gradient-to)'; break;
      case 'via': decl = '--tw-gradient-stops:var(--tw-gradient-from),' + col + ' var(--tw-gradient-via-position),var(--tw-gradient-to)!important'; break;
      case 'to': decl = '--tw-gradient-to:' + col + ' var(--tw-gradient-to-position)!important'; break;
    }
    return root + s + '{' + decl + '}\n';
  }

  function build() {
    var out = [], i, base = [], vari = [];
    // primeiro as classes simples, depois hover/focus: a de estado tem de ganhar
    for (i = 0; i < CLASSES.length; i++) (CLASSES[i].indexOf(':') > 0 ? vari : base).push(CLASSES[i]);
    var all = base.concat(vari);
    for (i = 0; i < all.length; i++) out.push(rule('oled', all[i], oled, false), rule('light', all[i], light, true));
    // texto branco sobre fundos que continuam escuros (selos sobre capas, fundo de diálogo)
    var keepDark = all.filter(function (c) { var m = RE.exec(c); return m && !m[1] && m[2] === 'bg' && (m[3] === 'black') && m[4] && parseInt(m[4], 10) >= 70; });
    keepDark.forEach(function (c) {
      // :not(#th) só soma especificidade para ganhar da regra geral de .text-white
      out.push('html[data-theme="light"] ' + sel(c) + '.text-white:not(#th),html[data-theme="light"] ' + sel(c) + ' > .text-white:not(#th){color:#fff}\n');
    });
    out.push(
      // claro: botão branco do play vira escuro, então o ícone preto vira branco
      'html[data-theme="light"] .bg-white.text-black:not(.th-keep *),html[data-theme="light"] .bg-white .text-black:not(.th-keep *){color:#fff}\n' +
      'html[data-theme="light"] body{background-color:#eceef2;color:#15151b}\n' +
      'html[data-theme="light"] *{scrollbar-color:rgba(0,0,0,.25) transparent}\n' +
      'html[data-theme="light"] *::-webkit-scrollbar-thumb{background:rgba(0,0,0,.2)}\n' +
      'html[data-theme="light"] .ambient-header{background:radial-gradient(900px 380px at 12% 0%,var(--ambient-color-1),transparent 70%),radial-gradient(700px 340px at 88% 5%,var(--ambient-color-2),transparent 70%),linear-gradient(180deg,#f3f5fb 0%,#ffffff 360px)}\n' +
      'html[data-theme="light"] .gt-card{background:#fff;border-color:rgba(0,0,0,.07);box-shadow:0 1px 3px rgba(0,0,0,.06)}\n' +
      'html[data-theme="light"] .gt-card:hover{background:#f6f7fa;box-shadow:0 14px 30px rgba(0,0,0,.12);border-color:rgba(0,0,0,.1)}\n' +
      'html[data-theme="light"] .track-row:hover{background-color:rgba(0,0,0,.05)}\n' +
      'html[data-theme="light"] .gt-card .play-fab{box-shadow:0 8px 18px rgba(0,0,0,.25)}\n' +
      'html[data-theme="light"] .shadow-2xl:not(.th-keep *){--tw-shadow:0 20px 40px -12px rgba(0,0,0,.25)}\n' +
      // OLED: tudo preto puro, cartões quase pretos para não sumirem
      'html[data-theme="oled"] body{background-color:#000}\n' +
      'html[data-theme="oled"] .ambient-header{background:radial-gradient(900px 380px at 12% 0%,var(--ambient-color-1),transparent 70%),radial-gradient(700px 340px at 88% 5%,var(--ambient-color-2),transparent 70%),#000}\n' +
      'html[data-theme="oled"] .gt-card{background:rgba(12,12,14,.9)}\n' +
      'html[data-theme="oled"] .gt-card:hover{background:rgba(26,26,30,.95)}\n'
    );
    return out.join('');
  }

  function current() {
    var t = 'dark';
    try { t = localStorage.getItem(KEY) || 'dark'; } catch (e) {}
    return NAMES[t] ? t : 'dark';
  }
  function apply(t) {
    var root = document.documentElement;
    root.setAttribute('data-theme', t);
    root.classList.toggle('dark', t !== 'light');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.appendChild(meta); }
    meta.content = t === 'light' ? '#eceef2' : '#000000';
  }

  var style = document.createElement('style');
  style.id = 'seer-theme-css';
  style.textContent = build();
  document.head.appendChild(style);
  apply(current());

  // window.seerTheme.set(nome[, vindoDoServidor]) troca e lembra; listeners recebem o nome.
  var listeners = [];
  window.seerTheme = {
    names: NAMES,
    short: SHORT,
    get: current,
    set: function (t, fromServer) {
      if (!NAMES[t]) return;
      try { localStorage.setItem(KEY, t); } catch (e) {}
      apply(t);
      listeners.forEach(function (f) { try { f(t, fromServer); } catch (e) {} });
    },
    onChange: function (f) { listeners.push(f); },
    css: build
  };
})();
