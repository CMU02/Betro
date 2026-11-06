"""Noto Sans KR / JetBrains Mono 정적 TTF를 필요한 글자만 남겨 assets/fonts에 쓴다.

실행: cd apps/native && uvx --from fonttools python scripts/subset-fonts.py
"""

from pathlib import Path

from fontTools import subset

ROOT = Path(__file__).resolve().parent.parent
PKG = ROOT / "node_modules" / "@expo-google-fonts"
OUT = ROOT / "assets" / "fonts"

LATIN_RANGES = [
    (0x0020, 0x007E),
    (0x00A0, 0x00FF),
    (0x2010, 0x2027),
    (0x2030, 0x205E),
    (0x2100, 0x214F),
    (0x2190, 0x21FF),
    (0x3000, 0x303F),
    (0x3131, 0x318E),
]
MONO_RANGES = [(0x0020, 0x007E), (0x00A0, 0x00FF), (0x2010, 0x2027), (0x2190, 0x21FF)]


def ks_x_1001_hangul() -> list[int]:
    codes = []
    for code in range(0xAC00, 0xD7A4):
        try:
            encoded = chr(code).encode("euc-kr")
        except UnicodeEncodeError:
            continue
        # Python의 euc-kr은 확장 완성형(UHC)까지 인코딩하므로 KS X 1001 영역(0xB0A1-0xC8FE)만 남긴다.
        if 0xB0 <= encoded[0] <= 0xC8 and encoded[1] >= 0xA1:
            codes.append(code)
    return codes


def expand(ranges: list[tuple[int, int]]) -> list[int]:
    return [c for start, end in ranges for c in range(start, end + 1)]


def run_subset(src: Path, dst: Path, codes: list[int]) -> None:
    options = subset.Options()
    options.layout_features = ["*"]
    options.name_IDs = ["*"]
    options.notdef_outline = True
    font = subset.load_font(str(src), options)
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=codes)
    subsetter.subset(font)
    subset.save_font(font, str(dst), options)
    print(f"{dst.name}: {dst.stat().st_size:,} bytes")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    hangul = ks_x_1001_hangul()
    noto_codes = sorted(set(expand(LATIN_RANGES) + hangul))
    (OUT / "subset-chars.txt").write_text("".join(chr(c) for c in noto_codes), encoding="utf8")

    noto = PKG / "noto-sans-kr"
    for weight, folder in [
        ("Regular", "400Regular"),
        ("Medium", "500Medium"),
        ("Bold", "700Bold"),
        ("Black", "900Black"),
    ]:
        run_subset(
            noto / folder / f"NotoSansKR_{folder}.ttf",
            OUT / f"NotoSansKR-{weight}.ttf",
            noto_codes,
        )

    mono = PKG / "jetbrains-mono"
    mono_codes = sorted(set(expand(MONO_RANGES)))
    for weight, folder in [("Medium", "500Medium"), ("Bold", "700Bold")]:
        run_subset(
            mono / folder / f"JetBrainsMono_{folder}.ttf",
            OUT / f"JetBrainsMono-{weight}.ttf",
            mono_codes,
        )


main()
