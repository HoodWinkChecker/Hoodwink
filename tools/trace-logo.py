# Traces brand/source/hoodwink-logo-original.png into a clean SVG mark (white hood + chartreuse eye).
import numpy as np, potrace, json, sys
from PIL import Image
im = np.asarray(Image.open('brand/source/hoodwink-logo-original.png').convert('RGB')).astype(int)
r, g, b = im[..., 0], im[..., 1], im[..., 2]
green = (g > 180) & (r < 230) & (b < 120)
white = (r > 150) & (g > 150) & (b > 150) & ~green

def path_of(mask, turd=40):
    bm = potrace.Bitmap(mask)
    pl = bm.trace(turdsize=turd, alphamax=1.0, opticurve=True, opttolerance=0.2)
    d = []
    for curve in pl:
        s = curve.start_point
        d.append(f'M{s.x:.1f} {s.y:.1f}')
        for seg in curve.segments:
            if seg.is_corner:
                d.append(f'L{seg.c.x:.1f} {seg.c.y:.1f}L{seg.end_point.x:.1f} {seg.end_point.y:.1f}')
            else:
                d.append(f'C{seg.c1.x:.1f} {seg.c1.y:.1f} {seg.c2.x:.1f} {seg.c2.y:.1f} {seg.end_point.x:.1f} {seg.end_point.y:.1f}')
        d.append('Z')
    return ''.join(d)

wd = path_of(~white)  # potracer traces False pixels as ink
ys, xs = np.nonzero(green)
gx0, gy0, gx1, gy1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
ys2, xs2 = np.nonzero(white | green)
x0, y0, x1, y1 = xs2.min(), ys2.min(), xs2.max() + 1, ys2.max() + 1
# square viewBox around the mark with a small margin
w, h = x1 - x0, y1 - y0
side = max(w, h) * 1.04
cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
vb = f'{cx - side / 2:.1f} {cy - side / 2:.1f} {side:.1f} {side:.1f}'
out = {'viewBox': vb, 'hood': wd, 'eye': [int(gx0), int(gy0), int(gx1 - gx0), int(gy1 - gy0)]}
json.dump(out, open('brand/source/mark.json', 'w'))
def svg(ink, eye, bg=None):
    rect = f'<rect x="{cx - side / 2:.1f}" y="{cy - side / 2:.1f}" width="{side:.1f}" height="{side:.1f}" fill="{bg}"/>' if bg else ''
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}">{rect}<path fill="{ink}" fill-rule="evenodd" d="{wd}"/><rect x="{gx0}" y="{gy0}" width="{gx1 - gx0}" height="{gy1 - gy0}" fill="{eye}"/></svg>'
open('brand/hoodwink-mark.svg', 'w').write(svg('#F4F2EC', '#CDF731'))
open('brand/hoodwink-mark-dark.svg', 'w').write(svg('#0A0A0A', '#9DBF14'))
open('brand/hoodwink-mark-bg.svg', 'w').write(svg('#F4F2EC', '#CDF731', '#0A0A0A'))
print(vb, len(wd), 'chars; eye', out['eye'])
