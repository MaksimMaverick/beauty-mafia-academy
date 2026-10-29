"""Украинский перевод лендинга: словарь-белый список строк (RU — исходный текст страницы).

  python tools/i18n.py extract     → i18n/todo.txt: строки без перевода, по одной в строке
  python tools/i18n.py pair FILE   → дописать в i18n/uk.tsv переводы из FILE (строки UA в порядке todo.txt)
  python tools/i18n.py build       → i18n/uk.js из i18n/uk.tsv; после — поднять CFG.i18n в index.html

Строки берутся так же, как их ищет i18n на странице: текст узлов (пробелы схлопнуты),
атрибуты placeholder/aria-label/alt/title, <title>, из скриптов — литералы t('…') и все
строки внутри блоков /*i18n*/ … /*/i18n*/. Внутри [data-noi18n] (отзывы) — не переводится.
Правка перевода: поменять строку в uk.tsv (RU<TAB>UA) → build.
"""
import html.parser
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGE = ROOT / 'index.html'
TSV = ROOT / 'i18n' / 'uk.tsv'
JS = ROOT / 'i18n' / 'uk.js'
TODO = ROOT / 'i18n' / 'todo.txt'
CYR = re.compile('[А-Яа-яЁё]')
ATTRS = ('placeholder', 'aria-label', 'alt', 'title', 'data-suffix')  # data-suffix — подписи счётчиков, их переводит t()
VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'}
SKIP = {'style', 'noscript', 'textarea'}


class Page(html.parser.HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack, self.found, self.scripts = [], [], []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        off = (self.stack[-1][1] if self.stack else False) or 'data-noi18n' in a
        if not off:
            self.found += [a[k].strip() for k in ATTRS if a.get(k) and CYR.search(a[k])]
        if tag not in VOID:
            self.stack.append((tag, off))

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]
                return

    def handle_data(self, data):
        tag, off = self.stack[-1] if self.stack else ('', False)
        if tag == 'script':
            self.scripts.append(data)
        elif tag not in SKIP and not off:
            s = ' '.join(data.split())
            if CYR.search(s):
                self.found.append(s)


def js_strings(code):
    out = re.findall(r"\bt\('((?:[^'\\]|\\.)*)'\)", code)
    for block in re.findall(r'/\*i18n\*/(.*?)/\*/i18n\*/', code, re.S):
        out += [m[1] for m in re.findall(r"""(['"])((?:(?!\1)[^\\]|\\.)*)\1""", block)]
    return [s.replace("\\'", "'") for s in out if CYR.search(s)]


def page_strings():
    p = Page()
    p.feed(PAGE.read_text(encoding='utf-8'))
    seen, res = set(), []
    for s in p.found + [x for code in p.scripts for x in js_strings(code)]:
        if s not in seen:
            seen.add(s)
            res.append(s)
    return res


def load_tsv():
    d = {}
    if TSV.exists():
        for line in TSV.read_text(encoding='utf-8').splitlines():
            if '\t' in line:
                ru, uk = line.split('\t', 1)
                d[ru] = uk
    return d


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    sys.stdout.reconfigure(encoding='utf-8')
    if cmd == 'extract':
        have, need = load_tsv(), page_strings()
        todo = [s for s in need if s not in have]
        TODO.write_text('\n'.join(todo) + ('\n' if todo else ''), encoding='utf-8')
        stale = [k for k in have if k not in set(need)]
        print(f'строк на странице: {len(need)}, без перевода: {len(todo)} → {TODO.name}, лишних в tsv: {len(stale)}')
    elif cmd == 'pair':
        ru = [s for s in TODO.read_text(encoding='utf-8').splitlines() if s]
        uk = [s for s in pathlib.Path(sys.argv[2]).read_text(encoding='utf-8').splitlines() if s.strip()]
        if len(ru) != len(uk):
            sys.exit(f'строк RU {len(ru)}, UA {len(uk)} — не совпадает, ничего не записано')
        with TSV.open('a', encoding='utf-8', newline='\n') as f:
            for a, b in zip(ru, uk):
                f.write(a + '\t' + b.strip() + '\n')
        print(f'добавлено переводов: {len(ru)}')
    elif cmd == 'build':
        d = load_tsv()
        need = set(page_strings())
        d = {k: v for k, v in d.items() if k in need}
        JS.write_text('window.BM_UK=' + json.dumps(d, ensure_ascii=False, separators=(',', ':')) + ';\n', encoding='utf-8')
        miss = [s for s in need if s not in d]
        print(f'{JS.name}: {len(d)} строк, без перевода осталось: {len(miss)}')
        for s in miss[:20]:
            print('  нет перевода:', s)
    else:
        print(__doc__)


if __name__ == '__main__':
    main()
