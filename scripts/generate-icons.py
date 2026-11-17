"""Generate matching VINote Android and iOS icons from a single geometry."""
import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
BLUE = '#075EE5'
PAPER = '#F7FAFF'
BARS = [(358, 479, 545), (438, 429, 595), (518, 389, 635), (598, 455, 569)]
BAR_WIDTH = 48
PAGE = (298, 244, 726, 780)
PAGE_RADIUS = 84


def render(size, desktop=False):
    if desktop:
        image = Image.new('RGBA', (1024, 1024))
        ImageDraw.Draw(image).rounded_rectangle((76, 76, 948, 948), radius=200, fill=BLUE)
    else:
        image = Image.new('RGB', (1024, 1024), BLUE)
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(PAGE, radius=PAGE_RADIUS, fill=PAPER)
    for x, top, bottom in BARS:
        draw.rounded_rectangle((x, top, x + BAR_WIDTH, bottom), radius=BAR_WIDTH // 2, fill=BLUE)
    return image.resize((size, size), Image.Resampling.LANCZOS)


def page_path():
    x, y, right, bottom = PAGE
    radius = PAGE_RADIUS
    width, height = right - x - 2 * radius, bottom - y - 2 * radius
    return (
        f'M{x + radius},{y}h{width}a{radius},{radius} 0,0 1,{radius} {radius}'
        f'v{height}a{radius},{radius} 0,0 1,-{radius} {radius}'
        f'h-{width}a{radius},{radius} 0,0 1,-{radius} -{radius}'
        f'v-{height}a{radius},{radius} 0,0 1,{radius} -{radius}z'
    )


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--desktop-source', type=Path, help='Write a transparent 1024px source for Tauri.')
options = parser.parse_args()
if options.desktop_source:
    render(1024, desktop=True).save(options.desktop_source)

assets = ROOT / 'assets/branding'
assets.mkdir(parents=True, exist_ok=True)
render(1024).save(assets / 'vinote-app-icon.png')
bars = ''.join(
    f'<rect x="{x}" y="{top}" width="{BAR_WIDTH}" height="{bottom-top}" rx="{BAR_WIDTH // 2}" fill="{BLUE}"/>'
    for x, top, bottom in BARS
)
(assets / 'vinote-app-icon.svg').write_text(
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">'
    f'<path fill="{BLUE}" d="M0 0h1024v1024H0z"/>'
    f'<path fill="{PAPER}" d="{page_path()}"/>{bars}</svg>',
    encoding='utf-8',
)

res = ROOT / 'android/app/src/main/res'
for density, size in [('mdpi', 48), ('hdpi', 72), ('xhdpi', 96), ('xxhdpi', 144), ('xxxhdpi', 192)]:
    folder = res / f'mipmap-{density}'
    folder.mkdir(parents=True, exist_ok=True)
    for name in ['ic_launcher', 'ic_launcher_round']:
        render(size).save(folder / f'{name}.png')

folder = res / 'drawable'
folder.mkdir(exist_ok=True)
# Android masks the central adaptive layer. Keep the waveform inset from the page edge.
vector_start = (
    '<vector xmlns:android="http://schemas.android.com/apk/res/android" '
    'android:width="108dp" android:height="108dp" '
    'android:viewportWidth="1024" android:viewportHeight="1024">'
)


def vector_bars(color):
    radius = BAR_WIDTH // 2
    return ''.join(
        f'<path android:pathData="M{x + radius},{top + radius}L{x + radius},{bottom - radius}" '
        f'android:strokeColor="{color}" android:strokeWidth="{BAR_WIDTH}" android:strokeLineCap="round"/>'
        for x, top, bottom in BARS
    )


foreground = f'{vector_start}<path android:pathData="{page_path()}" android:fillColor="{PAPER}"/>{vector_bars(BLUE)}</vector>'
(folder / 'vinote_icon_foreground.xml').write_text(foreground, encoding='utf-8')
monochrome = (
    f'{vector_start}<path android:pathData="{page_path()}" '
    'android:fillColor="@android:color/transparent" android:strokeColor="#000000" android:strokeWidth="36"/>'
    f'{vector_bars("#000000")}</vector>'
)
(folder / 'vinote_icon_monochrome.xml').write_text(monochrome, encoding='utf-8')
for version in ['v26', 'v33']:
    folder = res / f'mipmap-anydpi-{version}'
    folder.mkdir(exist_ok=True)
    mono = '<monochrome android:drawable="@drawable/vinote_icon_monochrome"/>' if version == 'v33' else ''
    xml = f'<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"><background android:drawable="@color/vinote_icon_background"/><foreground android:drawable="@drawable/vinote_icon_foreground"/>{mono}</adaptive-icon>'
    for name in ['ic_launcher', 'ic_launcher_round']:
        (folder / f'{name}.xml').write_text(xml, encoding='utf-8')
(res / 'values/vinote_icon_colors.xml').write_text(f'<resources><color name="vinote_icon_background">{BLUE}</color></resources>', encoding='utf-8')

folder = ROOT / 'ios/VINoteApp/Images.xcassets/AppIcon.appiconset'
manifest = json.loads((folder / 'Contents.json').read_text(encoding='utf-8'))
for entry in manifest['images']:
    pixels = round(float(entry['size'].split('x')[0]) * float(entry['scale'][:-1]))
    entry['filename'] = f'icon-{pixels}.png'
    render(pixels).save(folder / entry['filename'])
(folder / 'Contents.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
print('Android and iOS icon assets generated.')
