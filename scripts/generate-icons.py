"""Generate matching VINote Android and iOS icons from a single geometry."""
from pathlib import Path
import json

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
BG = '#FAFAFA'
INK = '#18181B'
WHITE = '#FFFFFF'
BARS = [(428, 493, 522), (474, 465, 550), (520, 437, 578), (566, 478, 537)]


def render(size):
    image = Image.new('RGB', (1024, 1024), BG)
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((190, 190, 834, 834), radius=162, fill=INK)
    draw.rounded_rectangle((367, 330, 657, 694), radius=52, fill=WHITE)
    for x, top, bottom in BARS:
        draw.rounded_rectangle((x, top, x + 26, bottom), radius=13, fill=INK)
    return image.resize((size, size), Image.Resampling.LANCZOS)


assets = ROOT / 'assets/branding'
assets.mkdir(parents=True, exist_ok=True)
render(1024).save(assets / 'vinote-app-icon.png')
bars = ''.join(f'<rect x="{x}" y="{top}" width="26" height="{bottom-top}" rx="13" fill="{INK}"/>' for x, top, bottom in BARS)
(assets / 'vinote-app-icon.svg').write_text(
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">'
    f'<path fill="{BG}" d="M0 0h1024v1024H0z"/>'
    f'<rect x="190" y="190" width="644" height="644" rx="162" fill="{INK}"/>'
    f'<rect x="367" y="330" width="290" height="364" rx="52" fill="{WHITE}"/>{bars}</svg>',
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
foreground = (
    '<vector xmlns:android="http://schemas.android.com/apk/res/android" '
    'android:width="108dp" android:height="108dp" '
    'android:viewportWidth="1024" android:viewportHeight="1024">'
    f'<path android:pathData="M352,190h320a162,162 0,0 1,162 162v320a162,162 0,0 1,-162 162h-320a162,162 0,0 1,-162 -162v-320a162,162 0,0 1,162 -162z" android:fillColor="{INK}"/>'
    f'<path android:pathData="M419,330h186a52,52 0,0 1,52 52v260a52,52 0,0 1,-52 52h-186a52,52 0,0 1,-52 -52v-260a52,52 0,0 1,52 -52z" android:fillColor="{WHITE}"/>'
    + ''.join(f'<path android:pathData="M{x+13},{top}L{x+13},{bottom}" android:strokeColor="{INK}" android:strokeWidth="26" android:strokeLineCap="round"/>' for x, top, bottom in BARS)
    + '</vector>'
)
(folder / 'vinote_icon_foreground.xml').write_text(foreground, encoding='utf-8')
monochrome = (
    '<vector xmlns:android="http://schemas.android.com/apk/res/android" '
    'android:width="108dp" android:height="108dp" '
    'android:viewportWidth="1024" android:viewportHeight="1024">'
    '<path android:pathData="M419,330h186a52,52 0,0 1,52 52v260a52,52 0,0 1,-52 52h-186a52,52 0,0 1,-52 -52v-260a52,52 0,0 1,52 -52z" '
    f'android:fillColor="@android:color/transparent" android:strokeColor="{INK}" android:strokeWidth="28"/>'
    + ''.join(f'<path android:pathData="M{x+13},{top}L{x+13},{bottom}" android:strokeColor="{INK}" android:strokeWidth="26" android:strokeLineCap="round"/>' for x, top, bottom in BARS)
    + '</vector>'
)
(folder / 'vinote_icon_monochrome.xml').write_text(monochrome, encoding='utf-8')
for version in ['v26', 'v33']:
    folder = res / f'mipmap-anydpi-{version}'
    folder.mkdir(exist_ok=True)
    mono = '<monochrome android:drawable="@drawable/vinote_icon_monochrome"/>' if version == 'v33' else ''
    xml = f'<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"><background android:drawable="@color/vinote_icon_background"/><foreground android:drawable="@drawable/vinote_icon_foreground"/>{mono}</adaptive-icon>'
    for name in ['ic_launcher', 'ic_launcher_round']:
        (folder / f'{name}.xml').write_text(xml, encoding='utf-8')
(res / 'values/vinote_icon_colors.xml').write_text(f'<resources><color name="vinote_icon_background">{BG}</color></resources>', encoding='utf-8')

folder = ROOT / 'ios/VINoteApp/Images.xcassets/AppIcon.appiconset'
manifest = json.loads((folder / 'Contents.json').read_text(encoding='utf-8'))
for entry in manifest['images']:
    pixels = round(float(entry['size'].split('x')[0]) * float(entry['scale'][:-1]))
    entry['filename'] = f'icon-{pixels}.png'
    render(pixels).save(folder / entry['filename'])
(folder / 'Contents.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
print('Android and iOS icon assets generated.')
