#!/usr/bin/env python3
"""Gera guitarr.live.html: o mock + camada live.js ligada ao Guitarr real."""
import sys

src, shim, out = sys.argv[1], sys.argv[2], sys.argv[3]
html = open(src, encoding='utf-8').read()

def sub(old, new, count=1):
    global html
    n = html.count(old)
    if n != count:
        sys.exit(f'ERRO: esperava {count} ocorrência(s) de {old[:70]!r}, achei {n}')
    html = html.replace(old, new)

# textos fixos do mock -> dados reais
sub('Boa tarde, Alex', '${greeting()}')
sub('461 faixas sincronizadas em <code class="text-[#3b8cff] font-semibold">/srv/music</code> · Aquisição automática via Soulseek FLAC & YouTube Music ativa.',
    '${TRACKS.length} faixas · ${ALBUMS.length} álbuns · ${ARTISTS.length} artistas na sua biblioteca. Pedidos automáticos.')
sub("const albumTracks = TRACKS.filter(t => t.album.toLowerCase() === album.title.toLowerCase() || t.artist.toLowerCase() === album.artist.toLowerCase());",
    "const albumTracks = TRACKS.filter(t => t.albumId === album.id).sort(byDiscTrack);")
sub('guitarr.example.com · v0.58 Pro', 'Seu Self-Hosted Music Player')
sub('<span id="sidebar-conn-label">Demo/API</span>', '<span id="sidebar-conn-label">conectando…</span>')
sub('id="nav-songs-count">461</span>', 'id="nav-songs-count">0</span>')
sub('class="text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#3b8cff]/20 text-[#3b8cff]">3 ativos</span>',
    'class="text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#3b8cff]/20 text-[#3b8cff]">0 ativos</span>')
sub('<span id="storage-used-label">10.4 GB</span>', '<span id="storage-used-label">—</span>')
sub('<span id="storage-limit-label">50 GB</span>', '<span id="storage-limit-label">—</span>')
sub('class="text-amber-400 font-medium">2 duplicatas</span>', 'class="text-amber-400 font-medium">—</span>')
sub('<span>437 GB livres no disco</span>', '<span id="sidebar-disk-free">—</span>')
sub('class="text-xs font-bold px-3 py-1.5 rounded-full bg-white/10 text-amber-300">10.4 GB / Duplicatas</button>',
    'id="mobile-storage-btn" class="text-xs font-bold px-3 py-1.5 rounded-full bg-white/10 text-amber-300">Espaço / Duplicatas</button>')

sub('<span class="text-[11px] font-medium px-2 py-0.5 rounded-full bg-white/[0.06] text-[#a7a7b0]">38</span>',
    '<span id="nav-albums-count" class="text-[11px] font-medium px-2 py-0.5 rounded-full bg-white/[0.06] text-[#a7a7b0]">0</span>')
sub('<span class="text-[11px] font-medium px-2 py-0.5 rounded-full bg-white/[0.06] text-[#a7a7b0]">14</span>',
    '<span id="nav-artists-count" class="text-[11px] font-medium px-2 py-0.5 rounded-full bg-white/[0.06] text-[#a7a7b0]">0</span>')
sub('<div class="w-6 h-6 rounded-full bg-gradient-to-tr from-[#3b8cff] to-emerald-700 text-black font-extrabold text-xs flex items-center justify-center">G</div>',
    '<div id="seer-user-avatar" class="w-6 h-6 rounded-full bg-gradient-to-tr from-[#3b8cff] to-emerald-700 text-black font-extrabold text-xs flex items-center justify-center">?</div>')
sub('<span class="text-xs font-bold hidden sm:inline">user</span>',
    '<span id="seer-user-name" class="text-xs font-bold hidden sm:inline">—</span>')
sub('list = [...list].reverse();', 'list = [...list].sort((a, b) => (b.plays || 0) - (a.plays || 0));')

# modal de armazenamento
sub('<span>Uso da Biblioteca: <span class="text-[#3b8cff]">10.4 GB</span></span>',
    '<span>Uso da Biblioteca: <span id="modal-used-val" class="text-[#3b8cff]">—</span></span>')
sub('<span>Disco total: 500 GB (/srv)</span>', '<span id="modal-disk-total">Disco total: —</span>')
sub('<span>437 GB livres (Mínimo livre: 2 GB)</span>', '<span id="modal-disk-free">—</span>')
sub('<p class="text-xs text-[#a7a7b0]">Controle de limite em <code class="text-[#3b8cff]">/srv/music</code> e deduplicação inteligente</p>',
    '<p class="text-xs text-[#a7a7b0]">Limite de espaço da biblioteca e limpeza de músicas duplicadas</p>')
sub('''<button type="button" onclick="closeModal('modal-storage')" class="px-5 py-2 rounded-full text-xs font-bold bg-[#3b8cff] text-black">Concluído</button>''',
    '''<button type="button" onclick="saveStorageAndClose()" class="px-5 py-2 rounded-full text-xs font-bold bg-[#3b8cff] text-black">Concluído</button>''')

# lista de músicas: limita as linhas desenhadas (bibliotecas grandes)
sub('${renderTrackTableRows(filtered)}',
    "${renderTrackTableRows(filtered.slice(0, 400))}"
    "${filtered.length > 400 ? `<div class=\"py-4 text-center text-xs text-[#a7a7b0]\">Mostrando 400 de ${filtered.length} músicas — use a busca para filtrar.</div>` : ''}")

# o servidor troca {{ .AppConfig }} (JSON com firstTime, versão...) ao servir /app/; o arquivo cru fica com o texto
assert html.count('</head>') == 1
html = html.replace('</head>', '<meta name="guitarr-config" content="{{ .AppConfig }}">\n</head>')

# camada live antes do </body>
import os
tag = '</body>'
assert html.count(tag) == 1
js = open(shim, encoding='utf-8').read()
assert '</script' not in js
html = html.replace(tag, '<script id="guitarr-live">\n' + js + '\n</script>\n' + tag)

# temas (theme.js) no <head>, com a lista de classes de cor usadas no mock e no live.js
import re, json
COLOR_RE = re.compile(r'^((?:hover|focus|group-hover):)?(bg|text|border|divide|from|via|to|placeholder)-(white|black|zinc-\d00|(?:red|amber|purple)-[234]00|\[#[0-9a-fA-F]{3,6}\])(?:/(\d+|\[[0-9.]+\]))?$')
classes = sorted({t for t in re.findall(r'[A-Za-z0-9:\-/\[\]#.]+', html) if COLOR_RE.match(t)})
theme = open(os.path.join(os.path.dirname(os.path.abspath(shim)), 'theme.js'), encoding='utf-8').read()
assert theme.count('/*@@COLOR_CLASSES@@*/[]') == 1 and '</script' not in theme
theme = theme.replace('/*@@COLOR_CLASSES@@*/[]', json.dumps(classes))
assert html.count('</head>') == 1
html = html.replace('</head>', '<script id="seer-theme">\n' + theme + '\n</script>\n</head>')

# marca: imagens inline geradas em brand/ (mkbrand.py)
here = os.path.dirname(os.path.abspath(__file__))
for key, fn in (('{{LOGO_MARK}}', 'inline_mark.txt'), ('{{FAVICON}}', 'inline_favicon.txt'), ('{{LOGO_VERTICAL}}', 'inline_vertical.txt')):
    path = os.path.join(here, 'brand', fn)
    if key in html:
        html = html.replace(key, open(path).read().strip())

# idiomas (i18n.js + i18n-en.tsv): inglês é o padrão, português (BR) o original
sys.path.insert(0, here)
from i18n_build import i18n_script
html = html.replace('</head>', '<script id="seer-i18n">\n' + i18n_script(here) + '\n</script>\n</head>')

open(out, 'w', encoding='utf-8').write(html)
print('ok', len(html), 'bytes')
