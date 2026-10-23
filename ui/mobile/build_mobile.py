#!/usr/bin/env python3
"""Junta shell.html + app.css + core/player/views.js em um index.html autônomo (usado em /app/mobile/)."""
import sys, pathlib
here = pathlib.Path(__file__).parent
out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else here.parent.parent / "apps" / "mobile" / "index.html"
shell = (here / "shell.html").read_text()
css = (here / "app.css").read_text()
js = "\n".join((here / f).read_text() for f in ("core.js", "offline.js", "player.js", "views.js", "extras.js", "native.js"))
assert "</script>" not in js, "js contém </script>"
sys.path.insert(0, str(here.parent))
from i18n_build import i18n_script  # noqa: E402  (mesmo motor e dicionário do site, mais os textos do mobile)
html = shell.replace("/*CSS*/", css).replace("/*JS*/", js)
assert html.count("</head>") == 1
html = html.replace("</head>", '<script id="seer-i18n">\n' + i18n_script(str(here.parent), extra="i18n-mobile.tsv") + "\n</script>\n</head>")
out.write_text(html)
print("ok", len(html), "bytes ->", out)
