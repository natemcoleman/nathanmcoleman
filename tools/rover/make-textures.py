"""Build the web textures for /rover/ from the NASA SVS 4720 source maps.

Put lroc_color_poles_4k.tif and ldem_16_uint.tif in static/rover/, then run:
    python tools/rover/make-textures.py
Needs numpy and Pillow. Writes the JPG/PNG maps and textures.json next to the game.
The elevation PNGs pack 16 bits as R = high byte, G = low byte.
"""
import json, os
import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
ROVER = os.path.join(os.path.dirname(__file__), '..', '..', 'static', 'rover')
os.chdir(ROVER)

color = Image.open('lroc_color_poles_4k.tif').convert('RGB')
color.resize((4096, 2048), Image.LANCZOS).save('lroc_color_4k.jpg', quality=88, optimize=True, progressive=True)
color.resize((2048, 1024), Image.LANCZOS).save('lroc_color_2k.jpg', quality=88, optimize=True, progressive=True)

# ldem_*_uint: half-metres, offset +20000, relative to 1737.4 km
dem = Image.fromarray(np.asarray(Image.open('ldem_16_uint.tif')).astype(np.float32), mode='F')
hi = np.asarray(dem.resize((2048, 1024), Image.BOX))
lo_v, hi_v = float(hi.min()), float(hi.max())
for name, size in {'ldem_16bit_2k.png': (2048, 1024), 'ldem_16bit_1k.png': (1024, 512)}.items():
    a = np.asarray(dem.resize(size, Image.BOX))
    q = np.round(np.clip((a - lo_v) / (hi_v - lo_v), 0, 1) * 65535).astype(np.uint16)
    rgb = np.zeros((size[1], size[0], 3), np.uint8)
    rgb[..., 0], rgb[..., 1] = q >> 8, q & 255
    Image.fromarray(rgb, 'RGB').save(name, optimize=True)

manifest = {
    "color": {"hi": "lroc_color_4k.jpg", "lo": "lroc_color_2k.jpg"},
    "dem": {"hi": "ldem_16bit_2k.png", "lo": "ldem_16bit_1k.png",
            "encoding": "rg16 (R=high byte, G=low byte, 0..65535 spans minKm..maxKm)",
            "minKm": round((lo_v - 20000) / 2000, 4), "maxKm": round((hi_v - 20000) / 2000, 4)},
    "credit": "NASA Scientific Visualization Studio (SVS 4720), LROC/ASU, LOLA/GSFC",
}
with open('textures.json', 'w') as f:
    json.dump(manifest, f, indent=2)
print(manifest)
