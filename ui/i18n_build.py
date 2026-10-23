"""Embute o motor de idiomas (i18n.js) com o dicionário PT-BR -> inglês (i18n-en.tsv [+ extra])."""
import json
import os
import sys


def i18n_script(base, extra=None):
    eng = open(os.path.join(base, 'i18n.js'), encoding='utf-8').read()
    d, rx = {}, []
    for name in ['i18n-en.tsv'] + ([extra] if extra else []):
        for line in open(os.path.join(base, name), encoding='utf-8'):
            line = line.rstrip('\n')
            if not line.strip() or line.startswith('#'):
                continue
            pt, sep, en = line.partition(' ||| ')
            if not sep:
                sys.exit(name + ': linha sem " ||| ": ' + line[:60])
            if pt.startswith('re:'):
                rx.append([pt[3:].strip(), en.strip()])
            else:
                d[' '.join(pt.split())] = en
    for k in ('@@I18N_DICT@@', '@@I18N_RE@@'):
        assert eng.count('/*' + k + '*/') == 1
    eng = eng.replace('/*@@I18N_DICT@@*/{}', json.dumps(d, ensure_ascii=False)).replace('/*@@I18N_RE@@*/[]', json.dumps(rx, ensure_ascii=False))
    assert '</script' not in eng
    return eng
