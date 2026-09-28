"""Create public display copies only. Originals are read-only and never deployed.

Usage: python scripts/publish-artwork.py --source "../Lakeland art"
Requires Pillow and opencv-python for video frame extraction. Add future entries to artwork.local.json in the source folder:
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

def watermark(im, y=.76):
    layer = Image.new('RGBA', im.size)
    draw = ImageDraw.Draw(layer)
    # One interior mark, matching the approved preview without regenerating art.
    size = max(9, round(im.width / 32))
    font = None
    for name in ['C:/Windows/Fonts/arial.ttf', 'DejaVuSans.ttf']:
        try:
            font = ImageFont.truetype(name, size)
            break
        except OSError:
            pass
    if font is None:
        raise RuntimeError('Install Arial or DejaVuSans for the watermark.')
    label = 'LAKELAND FINE ARTS'
    draw.text((im.width * .5, im.height * y), label, anchor='mm',
              font=font, fill=(255,255,255,55),
              stroke_width=1, stroke_fill=(0,0,0,32))
    return Image.alpha_composite(im, layer)

def prepare(source):
    entries = []
    entries.append(dict(file='Whimsy archive art/Art videos/finished-farm-stickers--2024-01-31--0515.mp4',
                        title='Finished farm stickers', artist='Kay Pickett', medium='Sticker designs',
                        fanArt=False, sculpture=False, compositeFrames=[1095, 1486, 1799]))
    entries.append(dict(file='Whimsy archive art/Art videos/monstera-babe-work-in-progress--2023-12-06--0587.mp4',
                        title='Monstera babe', artist='Kay Pickett', medium='Paintings',
                        fanArt=False, sculpture=False, lastFrame=True))
    entries.append(dict(file='Whimsy archive art/Art videos/ghibli-composition-work-in-progress--2023-12-20--0569.mp4',
                        title='Ghibli character collage - round', artist='Kay Pickett', medium='Paintings',
                        fanArt=True, sculpture=False, lastFrame=True))
    entries.append(dict(file='Whimsy archive art/Art videos/bluey-fan-art-poster--2023-11-27--0609.mp4',
                        title='Bluey fan art poster', artist='Kay Pickett', medium='Paintings',
                        fanArt=True, sculpture=False, lastFrame=True))
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
            # User confirmed this specific plate is original artwork by Kay Pickett.
            if int(row['archive_id']) == 789:
                cat = 'Paintings'
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
    # Split the reviewed owl collage into its original photographic panels.
    expanded = []
    for entry in entries:
        if entry['title'] == 'Custom baby portrait with reference':
            entry = dict(entry, crop=[0, 162 / 1200, 1, 1039 / 1200])
        if entry['title'] == 'Howl and sophie painted box lid':
            # Remove only the white collage margins around the photograph.
            entry = dict(entry, crop=[0, 136 / 1200, 1190 / 1200, 1040 / 1200])
        if entry['title'] == 'Needle felt owl multiple views':
            for label, box in [('Front view', (4, 8, 596, 1192)),
                               ('Back view', (672, 8, 1141, 592)),
                               ('Side view', (672, 610, 1143, 1192))]:
                expanded.append(dict(entry, title='Needle felt owl', viewLabel=label,
                                     crop=[v / 1200 for v in box]))
        else:
            expanded.append(entry)
    entries = expanded
    OUTPUT.mkdir(parents=True, exist_ok=True)
    gallery, audit = [], []
    hashes = set()
    for entry in entries:
        # Reviewed visual duplicate of the retained 2024 archive image.
        if entry['title'] in ('Farm animal sticker sketches', 'Miniature sculptures art 634 display', 'Self portrait blue background', 'Kettle of the vultures character concept', 'Art print display',
                              'Live painting fantasy collaboration', 'Fantasy creatures on purple canvas',
                              'Fantasy creatures coloring page collaboration', 'Victor ohmbre collaboration in progress'):
            excluded.append(entry['file'])
            continue
        if Path(entry['file']).name in ('howls-moving-castle--2018-09-30--0700.jpg',
                                       'antlered-forest-spirit-original--2019-04-19--0650.jpg',
                                       'antlered-forest-spirit-redraw--undated--0778.jpg',
                                       'antlered-forest-spirit-redraw--undated--0790.jpg',
                                       'four-eyed-pastel-cat--2018-10-19--0696.jpg'):
            excluded.append(entry['file'])
            continue
        # Artist-confirmed identification; preserve the fan-art classification on rebuild.
        if entry['title'] == 'Jon and aiden painted name plaques':
            entry['medium'] = 'Paintings'
            entry['fanArt'] = True
        if entry['title'] == 'Screaming sun mountain landscape':
            entry['fanArt'] = True
        if entry['title'] == 'Howls moving castle couple wood plaque':
            entry['fanArt'] = False
            entry['medium'] = 'Paintings'
        if entry['title'] == 'Pink haired woman abstract background':
            entry['fanArt'] = True
        file = (source / entry['file']).resolve()
        if not file.is_relative_to(source) or file.is_relative_to(PUBLIC):
            raise ValueError('Source must remain within the private source folder.')
        original = file.read_bytes()
        digest = hashlib.sha256(original).hexdigest()
        view_key = (digest, tuple(entry.get('crop', [])), entry.get('frameIndex'))
        if view_key in hashes:
            continue
        hashes.add(view_key)
        if entry.get('compositeFrames'):
            import cv2
            capture = cv2.VideoCapture(str(file))
            panels = []
            for index in entry['compositeFrames']:
                capture.set(cv2.CAP_PROP_POS_FRAMES, index)
                ok, frame = capture.read()
                if not ok:
                    raise ValueError('Cannot decode sticker frame.')
                panel = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
                bounds = panel.convert('L').point(lambda value: 255 if value < 235 else 0).getbbox()
                panels.append(panel.crop(bounds))
            capture.release()
            opened_image = Image.new('RGB', (sum(p.width for p in panels) + 32, max(p.height for p in panels)), 'white')
            x = 0
            for panel in panels:
                opened_image.paste(panel, (x, (opened_image.height - panel.height) // 2))
                x += panel.width + 16
        elif entry.get('lastFrame') or 'frameIndex' in entry:
            import cv2
            capture = cv2.VideoCapture(str(file))
            last = None
            if 'frameIndex' in entry:
                capture.set(cv2.CAP_PROP_POS_FRAMES, entry['frameIndex'])
            while True:
                ok, frame = capture.read()
                if not ok:
                    break
                last = frame
                if 'frameIndex' in entry:
                    break
            capture.release()
            if last is None:
                raise ValueError('Video contains no decodable frames.')
            opened_image = Image.fromarray(cv2.cvtColor(last, cv2.COLOR_BGR2RGB))
        else:
            opened_image = Image.open(file)
        with opened_image as opened:
            original_size = opened.size
            im = ImageOps.exif_transpose(opened).convert('RGBA')
            if entry.get('trimWhite'):
                bounds = im.convert('L').point(lambda value: 255 if value < 235 else 0).getbbox()
                if bounds:
                    im = im.crop(bounds)
            if entry.get('crop'):
                x1, y1, x2, y2 = entry['crop']
                im = im.crop((round(x1 * im.width), round(y1 * im.height),
                              round(x2 * im.width), round(y2 * im.height)))
            im.thumbnail((1200,1200), Image.Resampling.LANCZOS)
            backdrop = Image.new('RGBA',im.size,(246,243,238,255))
            im = Image.alpha_composite(backdrop,im)
            marked = not entry.get('sculpture',False)
            if marked:
                watermark_y = {'Rabbit breathing galaxy': .65, 'Memorial tattoo rainbow wings': .48}
                im = watermark(im, y=watermark_y.get(entry['title'], .76))
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
        for field in ['itemId', 'description', 'viewLabel']:
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
