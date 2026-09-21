"""Create public display copies only. Originals are read-only and never deployed.

Usage: python scripts/publish-artwork.py --source "../Lakeland art"
Requires Pillow. Add future entries to artwork.local.json in the source folder:
[{"file":"new-painting.png","title":"Title","artist":"Artist","medium":"Painting",
  "fanArt":false,"sculpture":false}]
"""
import argparse
import csv
import hashlib
import json
import re
import subprocess
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / 'src/Lakeland.OrderFulfilment.Api/wwwroot'
OUTPUT = PUBLIC / 'art/display'

def watermark(im):
    layer = Image.new('RGBA', im.size)
    draw = ImageDraw.Draw(layer)
    size = max(12, round(im.width / 30))
    font = None
    for name in ['C:/Windows/Fonts/arialbd.ttf', 'DejaVuSans-Bold.ttf']:
        try:
            font = ImageFont.truetype(name, size)
            break
        except OSError:
            pass
    if font is None:
        raise RuntimeError('Install Arial or DejaVuSans-Bold for the watermark.')
    label = 'LAKELAND FINE ARTS'
    step = round(draw.textlength(label, font=font)) + size * 2
    for row, y in enumerate(range(size, im.height, size * 5)):
        for x in range(-step // 3 if row % 2 else size, im.width, step):
            draw.text((x,y), label, font=font, fill=(255,255,255,105),
                      stroke_width=1, stroke_fill=(0,0,0,90))
    return Image.alpha_composite(im, layer)

def prepare(source):
    entries = []
    archive = source / 'Whimsy archive art'
    seen = set()
    excluded = []
    if (archive / 'artwork-manifest.csv').exists():
        for row in csv.DictReader((archive / 'artwork-manifest.csv').open(encoding='utf-8-sig')):
            file = archive / row['filename']
            if file in seen:
                continue
            seen.add(file)
            cat = row['category']
            if cat in ['Reference art - attribution unconfirmed', 'Community art', 'Videos to identify', 'Art videos']:
                excluded.append(str(file.relative_to(source)))
                continue
            ident = int(row['archive_id'])
            title = file.stem.split('--')[0].replace('-', ' ').capitalize()
            sculpture = cat == 'Sculptures' or ident in [542,543,544,545,554,664,665,666,668]
            entries.append(dict(file=str(file.relative_to(source)), title=title,
                artist='John Bieniek' if ident == 31 else 'Kay Pickett / Victor Ohmbre' if ident in [654,655,656,657,677,678,679,680,681,748] else 'Kay Pickett',
                medium='Sculpture' if sculpture else cat,
                fanArt=cat == 'Fan art', sculpture=sculpture))
    for file in sorted(source.glob('*.png')) + sorted(source.glob('*.jpg')):
        entries.append(dict(file=file.name,title=file.stem.replace(' clean',''),artist='Kay Pickett',medium='Painting',fanArt=False,sculpture=False))
    for file in sorted((source / 'Beekeeper and doctor mockup').glob('*.png')):
        title = re.sub(r'-[a-f0-9]{10,}$','',file.stem).replace('-',' ')
        entries.append(dict(file=str(file.relative_to(source)),title='Beekeeper and doctor — '+title,artist='Kay Pickett',medium='Mug design mockup',fanArt=False,sculpture=False))
    extra = source / 'artwork.local.json'
    if extra.exists():
        entries.extend(json.loads(extra.read_text(encoding='utf-8-sig')))
    OUTPUT.mkdir(parents=True, exist_ok=True)
    gallery, audit = [], []
    hashes = set()
    for entry in entries:
        file = (source / entry['file']).resolve()
        if not file.is_relative_to(source) or file.is_relative_to(PUBLIC):
            raise ValueError('Source must remain within the private source folder.')
        original = file.read_bytes()
        digest = hashlib.sha256(original).hexdigest()
        if digest in hashes:
            continue
        hashes.add(digest)
        with Image.open(file) as opened:
            original_size = opened.size
            im = ImageOps.exif_transpose(opened).convert('RGBA')
            im.thumbnail((1200,1200), Image.Resampling.LANCZOS)
            backdrop = Image.new('RGBA',im.size,(246,243,238,255))
            im = Image.alpha_composite(backdrop,im)
            marked = not entry.get('sculpture',False)
            if marked:
                im = watermark(im)
            slug = re.sub('[^a-z0-9]+','-',entry['title'].lower()).strip('-')[:90]
            # Content-address the derivative, not the private source.
            import io
            buf = io.BytesIO()
            im.convert('RGB').save(buf,format='WEBP',quality=78,method=6)
            data=buf.getvalue()
        display_hash = hashlib.sha256(data).hexdigest()
        name = f'{slug}-{display_hash[:12]}.webp'
        (OUTPUT/name).write_bytes(data)
        gallery.append(dict(id='art-'+display_hash[:16],title=entry['title'],artist=entry['artist'],
            medium=entry['medium'],fanArt=entry.get('fanArt',False),productId=None,
            image='/art/display/'+name,width=im.width,height=im.height,
            watermarked=marked,isSample=False,displaySha256=display_hash))
        for field in ['itemId', 'description']:
            if entry.get(field):
                gallery[-1][field] = entry[field]
        audit.append(dict(source=entry['file'],sourceSha256=digest,sourceWidth=original_size[0],
            sourceHeight=original_size[1],display='/art/display/'+name,watermarked=marked,printReady=False))
        assert hashlib.sha256(file.read_bytes()).hexdigest()==digest
    (PUBLIC/'art/gallery.json').write_text(json.dumps(gallery,indent=2)+'\n',encoding='utf-8')
    subprocess.run(['node', str(ROOT/'scripts/group-artwork.mjs')], check=True)
    private = ROOT/'artifacts/art-publishing'
    private.mkdir(parents=True,exist_ok=True)
    (private/'private-source-manifest.json').write_text(json.dumps(dict(files=audit,excluded=excluded),indent=2),encoding='utf-8')
    print(json.dumps(dict(published=len(gallery),watermarked=sum(x['watermarked'] for x in gallery),
        sculpturePhotos=sum(not x['watermarked'] for x in gallery),heldPrivate=len(excluded)),indent=2))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',required=True,type=Path)
    args=parser.parse_args()
    source=args.source.resolve()
    if source.is_relative_to(ROOT):
        raise ValueError('Keep originals outside the source-code repository.')
    prepare(source)
