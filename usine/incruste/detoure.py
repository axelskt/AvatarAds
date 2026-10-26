import glob, os, time
from rembg import new_session, remove
from PIL import Image
s = new_session('isnet-general-use')
t0 = time.time()
fs = sorted(glob.glob('f/*.png'))
for i, f in enumerate(fs):
    out = 'm2/' + os.path.basename(f)
    if os.path.exists(out): continue
    im = Image.open(f).convert('RGB')
    small = im.resize((540, 960))
    mask = remove(small, session=s, only_mask=True).resize(im.size, Image.BILINEAR)
    mask.save(out)
    if i % 10 == 0: print(i, round(time.time() - t0, 1), flush=True)
print('fini', round(time.time() - t0, 1))
