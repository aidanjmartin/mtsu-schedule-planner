#!/usr/bin/env python3
"""Build dist/planner.html: one HTML file with the page's scripts, styles, and data inside it.

The CDN script tags for the graph libraries stay as tags. Everything else is inlined:

  * web/styles.css becomes a <style> block.
  * web/app.js and web/engine/*.js become one <script type="module"> block. The build wraps each module in
    a function and replaces its import lines, so the modules keep separate names.
  * data/catalogs/*.json, data/schedule/<term>.json, and data/offerings.json become one JSON block that the
    page reads at start-up instead of fetching files.

Usage (from the repository root):

    python3 tools/build.py
    python3 tools/build.py --schedule-terms 8     # keep only the newest 8 schedule files
    python3 tools/build.py --out dist/planner.html

The modules must use only these forms, which the build checks:
    import { a, b as c } from './x.js';     import * as X from './x.js';
    export function f() {}                  export const x = 1;      export class C {}
"""

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

IMPORT_RE = re.compile(
    r"^import\s+(?:\*\s+as\s+(?P<ns>\w+)|\{(?P<names>[^}]*)\})\s+from\s+'(?P<path>[^']+)';?[ \t]*$",
    re.MULTILINE,
)
EXPORT_DECL_RE = re.compile(r"^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+(?P<name>\w+)", re.MULTILINE)
BAD_EXPORT_RE = re.compile(r"^export\s+(?:default|\{|\*)", re.MULTILINE)
SCHEDULE_FILE_RE = re.compile(r"^\d{4}(FA|SP|SU)\.json$")


class BuildError(Exception):
    pass


def module_var(path, root):
    rel = path.relative_to(root).with_suffix("")
    return "__m_" + re.sub(r"\W", "_", rel.as_posix())


def load_module(path, root, seen, order, stack=()):
    """Read a module and its imports, depth first, so dependencies come first in `order`."""
    path = path.resolve()
    if path in stack:
        raise BuildError(f"Import cycle: {' -> '.join(p.name for p in stack + (path,))}")
    if path in seen:
        return
    text = path.read_text(encoding="utf-8")
    if BAD_EXPORT_RE.search(text):
        raise BuildError(f"{path}: use 'export function', 'export const', or 'export class' only.")
    deps = []
    for match in IMPORT_RE.finditer(text):
        dep = (path.parent / match.group("path")).resolve()
        if not dep.exists():
            raise BuildError(f"{path}: cannot find {match.group('path')}")
        deps.append(dep)
        load_module(dep, root, seen, order, stack + (path,))
    if re.search(r"^import\s", IMPORT_RE.sub("", text), re.MULTILINE):
        raise BuildError(f"{path}: an import line has a form the build does not handle.")
    seen[path] = text
    order.append(path)


def transform(path, text, root):
    """Turn one module into a function-scoped block that returns its exports."""
    exports = EXPORT_DECL_RE.findall(text)
    header = []

    def replace_import(match):
        dep = (path.parent / match.group("path")).resolve()
        var = module_var(dep, root)
        if match.group("ns"):
            header.append(f"const {match.group('ns')} = {var};")
        else:
            names = [n.strip() for n in match.group("names").split(",") if n.strip()]
            names = [re.sub(r"\s+as\s+", ": ", n) for n in names]
            header.append(f"const {{ {', '.join(names)} }} = {var};")
        return ""

    body = IMPORT_RE.sub(replace_import, text)
    body = re.sub(r"^export\s+", "", body, flags=re.MULTILINE)
    return (
        f"const {module_var(path, root)} = (() => {{\n"
        + "\n".join(header)
        + "\n"
        + body
        + f"\nreturn {{ {', '.join(exports)} }};\n}})();\n"
    )


def bundle(entry, root):
    seen, order = {}, []
    load_module(entry, root, seen, order)
    code = "\n".join(transform(p, seen[p], root) for p in order)
    if re.search(r"</script", code, re.IGNORECASE):
        raise BuildError("The scripts contain '</script', which would end the inline block early.")
    return code


def collect_data(data_dir, schedule_terms=None):
    data_dir = Path(data_dir)
    out = {"catalogs": {}, "offerings": None, "schedules": {}}
    for path in sorted((data_dir / "catalogs").glob("*.json")):
        out["catalogs"][path.stem] = json.loads(path.read_text(encoding="utf-8"))
    offerings = data_dir / "offerings.json"
    if offerings.exists():
        out["offerings"] = json.loads(offerings.read_text(encoding="utf-8"))
    files = sorted(p for p in (data_dir / "schedule").glob("*.json") if SCHEDULE_FILE_RE.match(p.name)) if (data_dir / "schedule").exists() else []
    if schedule_terms:
        files = sorted(files, key=lambda p: term_sort_key(p.stem))[-schedule_terms:]
    for path in files:
        out["schedules"][path.stem] = json.loads(path.read_text(encoding="utf-8"))
    return out


def term_sort_key(term):
    year, code = int(term[:4]), term[4:]
    academic = year if code == "FA" else year - 1
    return academic * 3 + ["FA", "SP", "SU"].index(code)


def json_for_html(value):
    """Compact JSON that is safe inside a <script> block."""
    text = json.dumps(value, separators=(",", ":"), ensure_ascii=True)
    return text.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")


def build(web_dir=ROOT / "web", data_dir=ROOT / "data", out=ROOT / "dist" / "planner.html", schedule_terms=None):
    web_dir = Path(web_dir)
    html = (web_dir / "index.html").read_text(encoding="utf-8")
    css = (web_dir / "styles.css").read_text(encoding="utf-8")
    code = bundle(web_dir / "app.js", web_dir)
    data = collect_data(data_dir, schedule_terms)

    link = '<link rel="stylesheet" href="styles.css">'
    script = '<script type="module" src="app.js"></script>'
    if link not in html or script not in html:
        raise BuildError("web/index.html no longer has the stylesheet link or app script tag the build replaces.")
    html = html.replace(link, f"<style>\n{css}\n</style>")
    inline = (
        f'<script type="application/json" id="planner-data">{json_for_html(data)}</script>\n'
        f'<script type="module">\n{code}\n</script>'
    )
    html = html.replace(script, inline)

    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")
    return out, data


def main(argv=None):
    parser = argparse.ArgumentParser(description="Build dist/planner.html from web/ and data/.")
    parser.add_argument("--web", default=str(ROOT / "web"))
    parser.add_argument("--data", default=str(ROOT / "data"))
    parser.add_argument("--out", default=str(ROOT / "dist" / "planner.html"))
    parser.add_argument("--schedule-terms", type=int, default=None, help="keep only the newest N schedule files")
    args = parser.parse_args(argv)
    try:
        out, data = build(args.web, args.data, args.out, args.schedule_terms)
    except BuildError as error:
        print(f"Build failed: {error}", file=sys.stderr)
        return 1
    size = out.stat().st_size / 1024
    print(f"Wrote {out} ({size:.0f} KB): {len(data['catalogs'])} catalogs, {len(data['schedules'])} schedule terms, "
          f"offerings {'included' if data['offerings'] else 'missing'}.")
    if not data["catalogs"]:
        print("Warning: no catalog files found, so the page will have no data to show.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
