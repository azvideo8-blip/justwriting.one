#!/usr/bin/env python3
"""A-12: одноразовая конвертация кадров руководства в WebP двух размеров.

Не часть сборки: запускается вручную, когда меняют JPEG-кадры гида.
Требует Pillow. Патчит public/docs/**/*.html на <picture>. Исходные JPEG
удаляются вручную после проверки ссылок (скрипт их не трогает).
"""
from pathlib import Path
import re
import sys

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "public" / "docs"
JPEG_Q = 82
WEBP_Q = 78

IMG_RE = re.compile(r'<img\s+src="img/([^"]+)\.jpg"([^>]*?)>')


def widths_for(directory: Path, original_width: int) -> tuple[list[int], int]:
    if directory.parent.name == "mobile":
        wanted = [390, 780]
        fallback = 390
    else:
        wanted = [1280, 2560]
        fallback = 1280
    scaled = sorted({min(w, original_width) for w in wanted})
    return scaled, min(fallback, original_width)


def resize(image: Image.Image, width: int) -> Image.Image:
    height = round(image.size[1] * width / image.size[0])
    return image.resize((width, height), Image.LANCZOS)


def ensure_variants(jpg: Path, scaled: list[int], fallback: int) -> tuple[list[tuple[str, int]], str, int, int]:
    image = Image.open(jpg).convert("RGB")
    webps: list[tuple[str, int]] = []
    for width in scaled:
        out = jpg.with_name(f"{jpg.stem}-{width}.webp")
        if not out.exists():
            resize(image, width).save(out, "WEBP", quality=WEBP_Q, method=6)
        webps.append((out.name, width))
    fallback_name = f"{jpg.stem}-{fallback}.jpg"
    out_jpg = jpg.with_name(fallback_name)
    if not out_jpg.exists():
        resize(image, fallback).save(out_jpg, "JPEG", quality=JPEG_Q, optimize=True, progressive=True)
    fallback_h = round(image.size[1] * fallback / image.size[0])
    return webps, fallback_name, fallback, fallback_h


def patch_page(page: Path) -> int:
    html = page.read_text(encoding="utf-8")
    directory = page.parent / "img"
    converted = 0

    def replace(match: re.Match[str]) -> str:
        nonlocal converted
        stem, attrs = match.group(1), match.group(2)
        prefix = html[:match.start()]
        if prefix.rfind("<picture>") > prefix.rfind("</picture>"):
            return match.group(0)
        jpg = directory / f"{stem}.jpg"
        if not jpg.exists():
            raise SystemExit(f"нет файла {jpg}")
        with Image.open(jpg) as image:
            original_w = image.size[0]
        scaled, fallback = widths_for(directory, original_w)
        webps, fallback_name, fallback_w, fallback_h = ensure_variants(jpg, scaled, fallback)
        converted += 1

        clean_attrs = re.sub(r'\s+(?:width|height)="[^"]*"', "", attrs)
        sizes = "390px" if directory.parent.name == "mobile" else "(max-width: 860px) 900px, 720px"
        srcset = ", ".join(f"img/{name} {width}w" for name, width in webps)
        indent_match = re.search(r"\n([ \t]*)$", "")
        indent = ""
        # Отступ строки достаётся из самого match: он стоит сразу после него.
        line_start = html.rfind("\n", 0, match.start()) + 1
        indent = re.match(r"[ \t]*", html[line_start:match.start()]).group(0)
        return (
            f"<picture>\n"
            f"{indent}  <source type=\"image/webp\" srcset=\"{srcset}\" sizes=\"{sizes}\">\n"
            f"{indent}  <img src=\"img/{fallback_name}\"{clean_attrs} width=\"{fallback_w}\" height=\"{fallback_h}\">\n"
            f"{indent}</picture>"
        )

    patched = IMG_RE.sub(replace, html)
    if patched != html:
        page.write_text(patched, encoding="utf-8", newline="\n")
    return converted


def main() -> int:
    total = 0
    for page in sorted(DOCS.rglob("*.html")):
        n = patch_page(page)
        if n:
            print(f"{page.relative_to(ROOT)}: {n}")
            total += n
    print(f"кадров: {total}")
    return 0 if total else 1


if __name__ == "__main__":
    sys.exit(main())
