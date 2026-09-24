"""从统一几何定义生成 VINote 原生图标；运行前安装 Pillow。"""
from pathlib import Path
import json
from PIL import Image, ImageDraw
ROOT = Path(__file__).resolve().parents[1]
BG = '#121B19'
FG = '#79E2B5'
# 折角笔记外轮廓与声波，限定在中央安全区。
PAGE = [(340,280),(590,280),(684,374),(684,744),(340,744),(340,280)]
WAVE = [(416,502),(416,570),(480,452),(480,620),(544,488),(544,584),(608,518),(608,554)]
def render(size):
    im=Image.new('RGB',(1024,1024),BG)
    d=ImageDraw.Draw(im)
    d.line(PAGE,fill=FG,width=32,joint='curve')
    d.line([(586,282),(586,378),(682,378)],fill=FG,width=28,joint='curve')
    for a,b in zip(WAVE[::2],WAVE[1::2]):
        d.line([a,b],fill=FG,width=30)
        for x,y in (a,b): d.ellipse((x-15,y-15,x+15,y+15),fill=FG)
    return im.resize((size,size),Image.Resampling.LANCZOS)
assets=ROOT/'assets/branding'
assets.mkdir(parents=True,exist_ok=True)
render(1024).save(assets/'vinote-app-icon.png')
path='M340 280H590L684 374V744H340Z M586 282V378H682 M416 502V570 M480 452V620 M544 488V584 M608 518V554'
(assets/'vinote-app-icon.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><path fill="{BG}" d="M0 0h1024v1024H0z"/><path d="{path}" fill="none" stroke="{FG}" stroke-width="30" stroke-linecap="round" stroke-linejoin="round"/></svg>',encoding='utf-8')
res=ROOT/'android/app/src/main/res'
for density,size in [('mdpi',48),('hdpi',72),('xhdpi',96),('xxhdpi',144),('xxxhdpi',192)]:
    folder=res/f'mipmap-{density}'
    folder.mkdir(parents=True,exist_ok=True)
    for name in ['ic_launcher','ic_launcher_round']: render(size).save(folder/f'{name}.png')
folder=res/'drawable'; folder.mkdir(exist_ok=True)
(folder/'vinote_icon_foreground.xml').write_text(f'<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" android:viewportWidth="1024" android:viewportHeight="1024"><path android:pathData="{path}" android:fillColor="@android:color/transparent" android:strokeColor="{FG}" android:strokeWidth="30" android:strokeLineCap="round" android:strokeLineJoin="round"/></vector>',encoding='utf-8')
for version in ['v26','v33']:
    folder=res/f'mipmap-anydpi-{version}'; folder.mkdir(exist_ok=True)
    mono='<monochrome android:drawable="@drawable/vinote_icon_foreground"/>' if version=='v33' else ''
    xml=f'<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"><background android:drawable="@color/vinote_icon_background"/><foreground android:drawable="@drawable/vinote_icon_foreground"/>{mono}</adaptive-icon>'
    for name in ['ic_launcher','ic_launcher_round']: (folder/f'{name}.xml').write_text(xml,encoding='utf-8')
(res/'values/vinote_icon_colors.xml').write_text(f'<resources><color name="vinote_icon_background">{BG}</color></resources>',encoding='utf-8')
folder=ROOT/'ios/VINoteApp/Images.xcassets/AppIcon.appiconset'
manifest=json.loads((folder/'Contents.json').read_text())
for entry in manifest['images']:
    pixels=round(float(entry['size'].split('x')[0])*float(entry['scale'][:-1]))
    entry['filename']=f'icon-{pixels}.png'
    render(pixels).save(folder/entry['filename'])
(folder/'Contents.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
print('Android adaptive/legacy icons and iOS icon catalog generated.')
