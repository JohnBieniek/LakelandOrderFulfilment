// Fail deployment if unmanaged raster files or private files enter public assets.
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../src/Lakeland.OrderFulfilment.Api/wwwroot/', import.meta.url));
const gallery = JSON.parse(readFileSync(path.join(root, 'art/gallery.json'), 'utf8'));
const approved = new Map(gallery.map(w => [w.image, w]));
for (const work of gallery) {
  if (!/^\/art\/display\/[a-z0-9-]+\.webp$/.test(work.image)) throw Error('Invalid artwork path');
  if (work.productId !== null || work.isSample !== false) throw Error('Archive works must remain gallery-only');
  if (work.width > 1200 || work.height > 1200 || !work.width || !work.height) throw Error('Invalid display size');
  if (!work.watermarked && work.medium !== 'Sculpture') throw Error('Flat artwork needs a watermark');
  const bytes = readFileSync(path.join(root, work.image));
  if (createHash('sha256').update(bytes).digest('hex') !== work.displaySha256) throw Error('Display asset checksum mismatch');
}
function walk(dir) {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir,item.name);
    if (item.isSymbolicLink()) throw Error('Public assets must not contain symlinks');
    if (item.isDirectory()) { walk(full); continue; }
    const rel = '/' + path.relative(root,full).split(path.sep).join('/');
    if (/\.(png|jpe?g|webp|gif|avif|bmp|tiff?|psd|psb|kra|procreate|zip|mp4|mov)$/i.test(item.name) && !approved.has(rel))
      throw Error('Unapproved media in public assets: '+rel);
    if (!approved.has(rel) && /original|master|private|manifest|secret|\.env/i.test(item.name)) throw Error('Possible private file in public assets: '+rel);
  }
}
walk(root);
console.log(`Verified ${gallery.length} approved display copies; no unmanaged media in public assets.`);
