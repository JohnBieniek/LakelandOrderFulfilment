// Fail deployment if unmanaged raster files or private files enter public assets.
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../src/Lakeland.OrderFulfilment.Api/wwwroot/', import.meta.url));
const gallery = JSON.parse(readFileSync(path.join(root, 'art/gallery.json'), 'utf8'));
// Reviewed partner branding is separate from artwork; require an exact checksum.
const brandAssets = new Map([['/brand/whimsy-logo.png', '2a8865d6973a901ee8a9854944ed4484bdf174508db5bf9d5147fb097d65174d']]);
const approved = new Map(gallery.map(w => [w.image, w]));
const approvedVideos = new Map([['/art/display/completed-needle-felt-owl.mp4', '90484dc354d8ee9cce0d0f03e1737e50183398d222913dcd6f600e849e99b1e7']]);
for (const [video, hash] of approvedVideos) {
  if (createHash('sha256').update(readFileSync(path.join(root, video))).digest('hex') !== hash) throw Error('Video checksum mismatch');
}
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
    if (approvedVideos.has(rel)) continue;
    if (brandAssets.has(rel)) {
      if (createHash('sha256').update(readFileSync(full)).digest('hex') !== brandAssets.get(rel)) throw Error('Partner logo checksum mismatch');
      continue;
    }
    if (/\.(png|jpe?g|webp|gif|avif|bmp|tiff?|psd|psb|kra|procreate|zip|mp4|mov)$/i.test(item.name) && !approved.has(rel))
      throw Error('Unapproved media in public assets: '+rel);
    if (!approved.has(rel) && /original|master|private|manifest|secret|\.env/i.test(item.name)) throw Error('Possible private file in public assets: '+rel);
  }
}
walk(root);
const items = JSON.parse(readFileSync(path.join(root, 'art/items.json'), 'utf8'));
const itemIds = new Set();
const included = new Set();
for (const item of items) {
  if (itemIds.has(item.id) || !item.description || !item.images?.length || item.productId !== null)
    throw Error('Invalid grouped artwork');
  itemIds.add(item.id);
  const hashes = new Set();
  for (const view of item.images) {
    if (view.type === 'video') {
      if (!approvedVideos.has(view.video) || !approved.has(view.image)) throw Error('Unapproved video or poster');
      continue;
    }
    const source = approved.get(view.image);
    if (!source || source.displaySha256 !== view.displaySha256 || source.fanArt !== item.fanArt
        || source.watermarked !== view.watermarked || source.width !== view.width || source.height !== view.height)
      throw Error('Grouped view is not an approved display copy');
    if (hashes.has(view.displaySha256)) throw Error('Duplicate view within an item');
    hashes.add(view.displaySha256);
    included.add(view.displaySha256);
  }
}
if (gallery.some(view => !included.has(view.displaySha256))) throw Error('An artwork view was lost during grouping');
console.log(`Verified ${gallery.length} approved display copies; no unmanaged media in public assets.`);
