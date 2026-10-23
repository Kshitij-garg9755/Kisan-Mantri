from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / 'android' / 'app' / 'src' / 'main' / 'res'
SCALE = 3
BACKGROUND = '#0B5B45'
LEAF = '#8AD476'
LEAF_LIGHT = '#C5E881'
CREAM = '#F3F7E9'
GOLD = '#F2BD55'
DENSITIES = {
    'ldpi': 0.75,
    'mdpi': 1,
    'hdpi': 1.5,
    'xhdpi': 2,
    'xxhdpi': 3,
    'xxxhdpi': 4,
}


def point(value: tuple[float, float], size: int) -> tuple[int, int]:
    scale = size * SCALE / 1024
    return round(value[0] * scale), round(value[1] * scale)


def curve(
    start: tuple[float, float],
    control1: tuple[float, float],
    control2: tuple[float, float],
    end: tuple[float, float],
    size: int,
) -> list[tuple[int, int]]:
    points = []
    for step in range(33):
        t = step / 32
        inverse = 1 - t
        x = inverse**3 * start[0] + 3 * inverse**2 * t * control1[0] + 3 * inverse * t**2 * control2[0] + t**3 * end[0]
        y = inverse**3 * start[1] + 3 * inverse**2 * t * control1[1] + 3 * inverse * t**2 * control2[1] + t**3 * end[1]
        points.append(point((x, y), size))
    return points


def draw_leaf(
    draw: ImageDraw.ImageDraw,
    size: int,
    start: tuple[float, float],
    control1: tuple[float, float],
    control2: tuple[float, float],
    tip: tuple[float, float],
    return1: tuple[float, float],
    return2: tuple[float, float],
    color: str,
) -> None:
    outer = curve(start, control1, control2, tip, size)
    inner = curve(tip, return1, return2, start, size)
    draw.polygon(outer + inner[1:], fill=color)
    draw.line(outer, fill=CREAM, width=max(3, round(size * SCALE * 13 / 1024)), joint='curve')


def make_mark(size: int) -> Image.Image:
    canvas = Image.new('RGBA', (size * SCALE, size * SCALE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)

    draw_leaf(draw, size, (510, 615), (432, 592), (322, 528), (272, 406), (291, 322), (438, 388), LEAF)
    draw_leaf(draw, size, (514, 535), (584, 506), (703, 440), (756, 302), (760, 220), (600, 344), LEAF_LIGHT)
    draw_leaf(draw, size, (509, 416), (478, 376), (420, 323), (430, 252), (487, 232), (535, 319), LEAF)

    stem = [point((512, 760), size), point((512, 345), size)]
    draw.line(stem, fill=CREAM, width=max(5, round(size * SCALE * 24 / 1024)), joint='curve')

    # Small circuit branches make the crop mark read as connected farming technology.
    circuit = [point((512, 690), size), point((652, 690), size), point((652, 754), size)]
    draw.line(circuit, fill=GOLD, width=max(3, round(size * SCALE * 15 / 1024)), joint='curve')
    for x, y in ((652, 754), (708, 634)):
        radius = max(4, round(size * SCALE * 17 / 1024))
        cx, cy = point((x, y), size)
        draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=GOLD)
    draw.line(
        [point((652, 690), size), point((708, 634), size)],
        fill=GOLD,
        width=max(3, round(size * SCALE * 15 / 1024)),
    )

    cx, cy = point((512, 174), size)
    radius = max(7, round(size * SCALE * 37 / 1024))
    draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=GOLD)
    return canvas.resize((size, size), Image.Resampling.LANCZOS)


def make_background(size: int) -> Image.Image:
    return Image.new('RGBA', (size, size), BACKGROUND)


def save_icon_assets() -> None:
    for density, factor in DENSITIES.items():
        folder = RES / f'mipmap-{density}'
        folder.mkdir(parents=True, exist_ok=True)
        legacy_size = round(48 * factor)
        background_size = round(108 * factor)
        foreground = make_mark(background_size)
        background = make_background(background_size)
        background.save(folder / 'ic_launcher_background.png')
        foreground.save(folder / 'ic_launcher_foreground.png')

        full_icon = make_background(legacy_size)
        full_icon.alpha_composite(make_mark(legacy_size))
        full_icon.convert('RGB').save(folder / 'ic_launcher.png', optimize=True)

        round_icon = full_icon.copy()
        mask = Image.new('L', (legacy_size, legacy_size), 0)
        ImageDraw.Draw(mask).ellipse((0, 0, legacy_size - 1, legacy_size - 1), fill=255)
        round_icon.putalpha(mask)
        round_icon.save(folder / 'ic_launcher_round.png', optimize=True)


def make_splash(width: int, height: int) -> Image.Image:
    image = Image.new('RGBA', (width * SCALE, height * SCALE), BACKGROUND)
    mark_size = round(min(width, height) * 0.42)
    mark = make_mark(mark_size)
    image.alpha_composite(mark, ((image.width - mark.width) // 2, (image.height - mark.height) // 2))
    return image.resize((width, height), Image.Resampling.LANCZOS)


def save_splash_assets() -> None:
    default_dir = RES / 'drawable'
    default_dir.mkdir(parents=True, exist_ok=True)
    make_splash(480, 800).convert('RGB').save(default_dir / 'splash.png', optimize=True)

    for folder in RES.glob('drawable-*'):
        name = folder.name
        if '-port-' in name:
            orientation = 'port'
        elif '-land-' in name:
            orientation = 'land'
        else:
            orientation = None
        density = next((key for key in DENSITIES if name.endswith(f'-{key}')), None)
        if orientation is None or density is None:
            continue
        factor = DENSITIES[density]
        if orientation == 'port':
            width, height = round(360 * factor), round(800 * factor)
        else:
            width, height = round(800 * factor), round(360 * factor)
        make_splash(width, height).convert('RGB').save(folder / 'splash.png', optimize=True)


if __name__ == '__main__':
    save_icon_assets()
    save_splash_assets()
    print('Generated original Kisan Mantri Android icons and splash assets.')