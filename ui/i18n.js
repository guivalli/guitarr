// Idiomas da interface: inglês (padrão) e português (BR).
// O código da interface é escrito em português; no inglês, os textos fixos são traduzidos na tela
// por um dicionário (i18n-en.tsv, embutido pelo build.py). Dados do usuário (títulos, artistas,
// letras) nunca entram no dicionário e passam como estão.
(function () {
  var KEY = 'nd_seer_lang';
  var DICT = /*@@I18N_DICT@@*/{};
  var RE = /*@@I18N_RE@@*/[].map(function (x) { return [new RegExp(x[0]), x[1]]; });

  function stored() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  var lang = stored() === 'pt' ? 'pt' : 'en';

  var LETTER = /[A-Za-zÀ-ÿ]/;
  var BOUND = /[^A-Za-zÀ-ÿ0-9]/;
  var longKeys = [], edgeKeys = [], longRe = null;
  Object.keys(DICT).forEach(function (k) {
    if (k.length >= 12 && k.indexOf(' ') > 0) longKeys.push(k);
    // chaves de várias palavras ou terminadas/iniciadas em pontuação servem de começo/fim de um texto montado
    if (k.indexOf(' ') > 0 || BOUND.test(k.charAt(0)) || BOUND.test(k.charAt(k.length - 1))) edgeKeys.push(k);
  });
  longKeys.sort(function (a, b) { return b.length - a.length; });
  edgeKeys.sort(function (a, b) { return b.length - a.length; });
  function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  if (longKeys.length) longRe = new RegExp(longKeys.map(esc).join('|'), 'g');

  var memo = Object.create(null);

  function part(x, depth) {
    var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(x);
    return m[2] ? m[1] + core(m[2], depth) + m[3] : x;
  }

  function core(s, depth) {
    if (Object.prototype.hasOwnProperty.call(DICT, s)) return DICT[s];
    if (!LETTER.test(s) || depth > 4) return s;
    var i, m;
    for (i = 0; i < RE.length; i++) {
      m = RE[i][0].exec(s);
      if (m) return s.replace(RE[i][0], RE[i][1]);
    }
    // "12 faixas": o número fica, o resto é traduzido
    m = /^([\d.,]+)\s+(\S.*)$/.exec(s);
    if (m) { var r = core(m[2], depth + 1); if (r !== m[2]) return m[1] + ' ' + r; }
    // frases longas dentro de um texto montado com dados
    var base = s;
    if (longRe) s = s.replace(longRe, function (k) { return DICT[k]; });
    // começo ou fim conhecido de um texto montado ("Tocando álbum "X"", ""X" removida dos Favoritos")
    for (i = 0; i < edgeKeys.length; i++) {
      var k = edgeKeys[i];
      if (s.length > k.length && s.indexOf(k) === 0 && (BOUND.test(s.charAt(k.length)) || BOUND.test(k.charAt(k.length - 1)))) {
        return DICT[k] + part(s.slice(k.length), depth + 1);
      }
      if (s.length > k.length && s.lastIndexOf(k) === s.length - k.length && (BOUND.test(s.charAt(s.length - k.length - 1)) || BOUND.test(k.charAt(0)))) {
        return part(s.slice(0, s.length - k.length), depth + 1) + DICT[k];
      }
    }
    // texto montado com vários pedaços ("24 faixas · 3 álbuns · Pedidos automáticos."): cada pedaço sozinho
    if (depth < 3) {
      var pieces = s.split(/( · | — |\. |: |, | \| |; )/);
      if (pieces.length > 1) {
        var changed = false;
        var joined = pieces.map(function (x, n) {
          if (n % 2) return x;
          var r = part(x, depth + 1);
          if (r !== x) changed = true;
          return r;
        }).join('');
        if (changed) return joined;
      }
    }
    return s;
  }

  function tr(s) {
    if (lang !== 'en' || !s || typeof s !== 'string') return s;
    var hit = memo[s];
    if (hit !== undefined) return hit;
    var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
    var c = m[2].replace(/\s+/g, ' ');
    var res = s;
    if (c) {
      var t = core(c, 0);
      if (t !== c) res = m[1] + t + m[3];
    }
    if (s.length < 400) memo[s] = res;
    return res;
  }

  // ------------------------------------------------------------ DOM ---
  var ATTRS = ['title', 'placeholder', 'aria-label', 'alt'];
  var SKIP = 'script,style,textarea,code,pre,.lyr-line,[data-notr],[contenteditable="true"]';
  var origText = new WeakMap();

  function doText(n) {
    var v = n.nodeValue;
    if (!v || !LETTER.test(v)) return;
    var o = origText.get(n);
    if (o && o.out === v) return;
    var p = n.parentNode;
    if (p && p.closest && p.closest(SKIP)) return;
    var t = tr(v);
    if (t !== v) { origText.set(n, { out: t }); n.nodeValue = t; }
  }
  var origAttr = new WeakMap();
  function doAttr(el, a) {
    var v = el.getAttribute(a);
    if (!v || !LETTER.test(v)) return;
    var rec = origAttr.get(el);
    if (rec && rec[a] === v) return;
    if (el.closest && el.closest(SKIP)) return;
    var t = tr(v);
    if (t !== v) { if (!rec) { rec = {}; origAttr.set(el, rec); } rec[a] = t; el.setAttribute(a, t); }
  }
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { doText(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 11) return;
    if (root.nodeType === 1) {
      if (root.matches && root.matches('script,style')) return;
      ATTRS.forEach(function (a) { if (root.hasAttribute(a)) doAttr(root, a); });
    }
    var tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    var n;
    while ((n = tw.nextNode())) doText(n);
    if (root.querySelectorAll) {
      root.querySelectorAll('[title],[placeholder],[aria-label],[alt]').forEach(function (el) {
        ATTRS.forEach(function (a) { if (el.hasAttribute(a)) doAttr(el, a); });
      });
    }
  }

  var observer = null;
  function start() {
    if (lang !== 'en' || observer) return;
    document.documentElement.lang = 'en';
    observer = new MutationObserver(function (recs) {
      for (var i = 0; i < recs.length; i++) {
        var r = recs[i];
        if (r.type === 'characterData') doText(r.target);
        else if (r.type === 'attributes') doAttr(r.target, r.attributeName);
        else for (var j = 0; j < r.addedNodes.length; j++) walk(r.addedNodes[j]);
      }
    });
    walk(document.body);
    if (document.title) document.title = tr(document.title);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

  ['alert', 'confirm', 'prompt'].forEach(function (k) {
    var orig = window[k];
    window[k] = function (m, d) { return orig.call(window, tr(String(m == null ? '' : m)), d); };
  });

  // ------------------------------------------------------------ API ---
  window.seerLang = function () { return lang; };
  window.seerLocale = function () { return lang === 'pt' ? 'pt-BR' : 'en-US'; };
  window.seerT = tr;
  // Troca o idioma: guarda neste navegador e recarrega (o estado da sessão volta sozinho).
  // `remember` recebe o idioma para guardar também na conta (a camada live.js grava no servidor).
  window.seerSetLang = function (l, remember) {
    l = l === 'pt' ? 'pt' : 'en';
    try { localStorage.setItem(KEY, l); sessionStorage.removeItem('nd_seer_lang_reload'); } catch (e) {}
    if (typeof remember === 'function') { try { remember(l); } catch (e) {} }
    setTimeout(function () { location.reload(); }, 250);
  };
  // O idioma da conta ganha do deste navegador (chamado depois de ler o estado do servidor).
  window.seerLangFromAccount = function (l) {
    if (l !== 'pt' && l !== 'en') return false;
    if (l === lang && stored() === l) return false;
    try { localStorage.setItem(KEY, l); } catch (e) {}
    if (l === lang) return false;
    try { if (sessionStorage.getItem('nd_seer_lang_reload')) return false; sessionStorage.setItem('nd_seer_lang_reload', '1'); } catch (e) {}
    location.reload();
    return true;
  };
  window.seerLangChips = function () {
    return [['en', 'English'], ['pt', 'Português (BR)']].map(function (x) {
      return '<button type="button" onclick="seerPickLang(\'' + x[0] + '\')" data-notr class="flex-1 px-2 py-1.5 rounded-lg text-xs font-bold transition ' +
        (lang === x[0] ? 'bg-[#3b8cff] text-black' : 'bg-white/[0.08] hover:bg-white/[0.14] text-white') + '">' + x[1] + '</button>';
    }).join('');
  };
})();
