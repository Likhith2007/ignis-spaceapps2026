#!/usr/bin/env python3
"""IGNIS brand pipeline — integrate the two supplied logos:
  upload/20261015_202808_Original.png  (mascot — orange satellite robot with flame)
  upload/20261015_202738_Original.png  (IGNIS glowing wordmark)
Outputs:
  public/brand/ignis-mascot.png        (512px, optimized)
  public/brand/ignis-mascot-small.png  (96px header chip)
  public/brand/ignis-wordmark.png      (resized 640px wide, optimized)
  public/brand/og-image.png            (1200x630: wordmark + mascot on IGNIS dark)
  src/app/icon.png                     (favicon 256px — mascot)
  src/app/apple-icon.png               (180px)
"""
from PIL import Image, ImageDraw, ImageFilter, ImageOps
import pathlib

WS = pathlib.Path('/home/z/my-project')
UP = WS / 'upload'
BRAND = WS / 'public' / 'brand'
BRAND.mkdir(parents=True, exist_ok=True)
APP = WS / 'src' / 'app'

mascot = Image.open(UP / '20261015_202808_Original.png').convert('RGBA')
word = Image.open(UP / '20261015_202738_Original.png').convert('RGBA')
print('mascot', mascot.size, 'wordmark', word.size)

# --- mascot: square-crop to content, save sizes (black bg kept — it sits on the dark UI) ---
m = ImageOps.contain(mascot, (512, 512))
m.save(BRAND / 'ignis-mascot.png', optimize=True)
ImageOps.contain(mascot, (96, 96)).save(BRAND / 'ignis-mascot-small.png', optimize=True)
# favicon (256) + apple (180) — mascot on the dark #050A14 tile
tile = Image.new('RGBA', (256, 256), (5, 10, 20, 255))
icon = ImageOps.contain(mascot, (224, 224))
tile.alpha_composite(icon, ((256 - icon.width) // 2, (256 - icon.height) // 2))
tile.save(APP / 'icon.png', optimize=True)
apple = Image.new('RGBA', (180, 180), (5, 10, 20, 255))
a = ImageOps.contain(mascot, (160, 160))
apple.alpha_composite(a, ((180 - a.width) // 2, (180 - a.height) // 2))
apple.save(APP / 'apple-icon.png', optimize=True)

# --- wordmark: autocrop to the glowing text (it is a 3264² square with centered text) ---
def autocrop(img, thresh=28, pad=18):
    gray = img.convert('L')
    mask = gray.point(lambda v: 255 if v > thresh else 0)
    bbox = mask.getbbox()
    if not bbox:
        return img
    l, t, r, b = bbox
    return img.crop((max(0, l - pad), max(0, t - pad), min(img.width, r + pad), min(img.height, b + pad)))

wordc = autocrop(word)
print('wordmark cropped ->', wordc.size)
w = wordc.resize((640, int(wordc.height * 640 / wordc.width)), Image.LANCZOS)
w.save(BRAND / 'ignis-wordmark.png', optimize=True)
w.save(BRAND / 'ignis-wordmark-h28.png', optimize=True)  # header asset (h-7 crisp)

# --- og-image 1200x630: dark IGNIS backdrop + wordmark + mascot + tagline ---
og = Image.new('RGB', (1200, 630), (5, 10, 20))
dr = ImageDraw.Draw(og)
for y in range(630):  # subtle vertical gradient
    t = y / 630
    dr.line([(0, y), (1200, y)], fill=(int(5 + 8 * t), int(10 + 14 * t), int(20 + 22 * t)))
# ember dots
import random
random.seed(7)
for _ in range(90):
    x, y = random.randint(0, 1199), random.randint(0, 629)
    r = random.choice([1, 1, 2])
    c = random.choice([(249, 115, 22), (239, 68, 68), (251, 146, 60), (120, 53, 15)])
    dr.ellipse([x - r, y - r, x + r, y + r], fill=c)
# glow behind wordmark
glow = Image.new('RGBA', (1200, 630), (0, 0, 0, 0))
gd = ImageDraw.Draw(glow)
wm = wordc.resize((820, int(wordc.height * 820 / wordc.width)), Image.LANCZOS)
mw = ImageOps.contain(mascot, (360, 360))
wx, wy = (1200 - wm.width) // 2, 150
mx, my = 1200 - mw.width - 40, 630 - mw.height - 16
gd.ellipse([wx - 60, wy - 20, wx + wm.width + 60, wy + wm.height + 40], fill=(249, 115, 22, 60))
glow = glow.filter(ImageFilter.GaussianBlur(60))
og.paste(glow, (0, 0), glow)
og.paste(wm, (wx, wy), wm)
og.paste(mw, (mx, my), mw)
d2 = ImageDraw.Draw(og)
tag = "EARTH'S BURNING ACTIVITY CALENDAR"
sub = "NASA Space Apps Challenge 2026 · MODIS + VIIRS harmonized · AI early warning"
d2.text((wx, wy + wm.height + 26), tag, fill=(226, 232, 240))
d2.text((wx, wy + wm.height + 56), sub, fill=(148, 163, 184))
og.save(BRAND / 'og-image.png', optimize=True)

# public og for repo metadata + existing references
import shutil
for name in ['og-image.png']:
    shutil.copy(BRAND / name, WS / 'public' / name)
print('brand assets written:', sorted(p.name for p in BRAND.iterdir()))
print('icon:', (APP / 'icon.png').exists(), 'apple:', (APP / 'apple-icon.png').exists())
