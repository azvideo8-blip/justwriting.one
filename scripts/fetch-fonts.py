#!/usr/bin/env python3
"""Скачивает веб-шрифты в public/fonts, чтобы они раздавались со своего домена.

Зачем: подключение fonts.googleapis.com / fonts.gstatic.com отправляет IP
каждого посетителя в Google (США) при каждой загрузке страницы — до входа и до
любого согласия. Для 152-ФЗ это трансграничная передача, которой у нас быть не
должно (D4.19 в docs/migration-plan.md).

Запуск: python3 scripts/fetch-fonts.py
Затем: проверить, что public/fonts/fonts.css перезаписан, и закоммитить.

Шрифты — из Google Fonts под лицензией SIL Open Font License 1.1, которая
разрешает размещение у себя. Набор семейств должен совпадать со списком в
src/features/settings/components/EditorTab.tsx — пользователь выбирает шрифт
редактора оттуда.
"""
import re
import pathlib
import urllib.request

CSS_URL = (
    "https://fonts.googleapis.com/css2?"
    "family=EB+Garamond:ital,wght@0,400..800;1,400..800"
    "&family=Inter:wght@400;500;600;700"
    "&family=JetBrains+Mono:wght@400;500"
    "&family=Lora:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500"
    "&family=Playfair+Display:ital,wght@0,400..900;1,400..900"
    "&display=swap"
)

# Без современного User-Agent Google отдаёт ttf вместо woff2.
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

# Греческий и вьетнамский не нужны: интерфейс русский и английский.
KEEP_SUBSETS = {"cyrillic", "cyrillic-ext", "latin", "latin-ext"}

HEADER = """/* Шрифты раздаются со своего домена. Прежде страница подключала
   fonts.googleapis.com и fonts.gstatic.com, то есть IP каждого посетителя
   уходил в Google (США) при каждой загрузке — до входа и до любого
   согласия. Файлы из Google Fonts, лицензия SIL OFL; оставлены только
   подмножества latin и cyrillic. Обновление — scripts/fetch-fonts.py. */
"""


def fetch(url: str) -> bytes:
    return urllib.request.urlopen(
        urllib.request.Request(url, headers={"User-Agent": UA}), timeout=30
    ).read()


def main() -> None:
    dest = pathlib.Path(__file__).resolve().parent.parent / "public" / "fonts"
    dest.mkdir(parents=True, exist_ok=True)

    css = fetch(CSS_URL).decode()
    blocks = re.findall(r"/\*\s*([\w-]+)\s*\*/\s*(@font-face\s*\{.*?\})", css, re.S)
    if not blocks:
        raise SystemExit("Google вернул CSS без @font-face — проверьте URL и User-Agent")

    faces: list[str] = []
    files: dict[str, str] = {}
    for subset, block in blocks:
        if subset not in KEEP_SUBSETS:
            continue
        family = re.search(r"font-family:\s*'([^']+)'", block).group(1)
        style = re.search(r"font-style:\s*(\w+)", block).group(1)
        # У переменных шрифтов вес — диапазон ("400 800"); он обязан входить в
        # имя файла, иначе начертания одного семейства затрут друг друга.
        weight = re.search(r"font-weight:\s*([\d ]+)", block).group(1).strip().replace(" ", "-")
        url = re.search(r"url\((https://[^)]+\.woff2)\)", block).group(1)

        name = f"{family.replace(' ', '')}-{style}-{weight}-{subset}.woff2"
        if files.setdefault(name, url) != url:
            raise SystemExit(f"два разных файла претендуют на имя {name}")
        faces.append(f"/* {family} {style} {weight} {subset} */\n" + block.replace(url, f"/fonts/{name}"))

    for name, url in files.items():
        (dest / name).write_bytes(fetch(url))

    (dest / "fonts.css").write_text(HEADER + "\n" + "\n\n".join(faces) + "\n", encoding="utf-8")

    total = sum(f.stat().st_size for f in dest.glob("*.woff2"))
    print(f"начертаний: {len(faces)}, файлов: {len(files)}, всего: {total / 1024:.0f} КБ")


if __name__ == "__main__":
    main()
