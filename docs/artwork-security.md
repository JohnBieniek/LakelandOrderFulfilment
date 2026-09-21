# Artwork storage and publishing

## Storage boundaries

Keep source code, public display copies, and print originals separate:

| Location | Contents | Access |
| --- | --- | --- |
| Shared Git repository | Application code, placeholder art, publishing scripts, public catalog metadata | Developers |
| Local Lakeland art folder | Existing source images and source manifests | Studio computer |
| Private R2 originals bucket (to provision) | Untouched source files, full-resolution print masters, private source manifest | Studio administrators and narrowly scoped fulfillment credentials |
| Cloudflare static assets | Reduced-resolution, flattened, watermarked display copies; reduced sculpture photographs | Public through the website |

Never bind the originals bucket to the public storefront Worker. Do not enable an r2.dev URL or public custom domain for the originals bucket. Do not place originals under wwwroot, static assets, deployment artifacts, or Git. Gitignore is a guardrail, not access control, and does not remove previously committed files from history.

R2 is not enabled on the connected Cloudflare account. The current free setup publishes only approved display copies through the existing Cloudflare static assets service. Clean originals remain local in Lakeland art; there is no cloud backup or private R2 bucket yet. No new billable service is enabled.

## Display policy

- Paintings, drawings, digital art, flat designs, and fan art: create a separate web copy, cap the longest edge at 1200 pixels without upscaling, remove metadata, and bake a repeated visible Lakeland Fine Arts watermark into the pixels across the image. A CSS overlay is insufficient because the underlying image remains clean.
- Sculpture-only photographs: reduced-resolution display copies without a watermark. If a sculpture photograph also shows a reproducible painting or design, watermark it.
- Retain originals byte-for-byte. Never apply watermarks to a print master.
- Keep reference art, uncertain attributions, and unidentified videos private pending review. Do not assert ownership by watermarking other artists' reference work.
- Art process videos can expose clean art on individual frames. Keep these private until a separate watermarked video export is prepared.
- Fan art stays in the display-only gallery with no product or print mapping.
- Publishing artwork does not imply it is available for sale. Prices, artists, availability, sizes, and print readiness must be supplied separately.

Anyone who can see a display copy can save it or take a screenshot. Watermarks and reduced resolution discourage reuse; they cannot prevent copying or watermark removal. Disabling right-click, hiding URLs, CORS, or robots.txt does not protect an original.

## Original library and printing

Use separate archive-source and print-master classifications. Facebook exports preserve the files available in that export, but are not necessarily print masters. Record pixel dimensions, source checksum, artist, artwork ID, and the approved print-master version. Review resolution against each intended print size and Printful product template before marking it ready.

The studio should retain a second independent backup of its masters. R2 storage is not a substitute for a backup policy.

Printful should receive only the selected approved print file through its authenticated integration. If an external service needs a download URL, generate a short-lived signed URL server-side and keep it out of the public catalog, browser responses, and logs. Such links grant access to whoever possesses them until expiration; account for the provider's download timing before choosing an expiry. No public master download endpoint is required.

## Adding artwork

The publishing flow is: add a source outside the repository, record title/artist/type/fan-art status, generate and inspect the display copy, upload only that copy to display storage, and publish its catalog entry. Back up originals separately using credentials scoped to the originals bucket. Do not send original files through a public upload endpoint.

A future browser administration page needs authenticated staff access and server-side authorization on every upload and publish operation. It must not embed storage credentials in browser code. Until implemented, use the local publishing workflow and Cloudflare's authenticated dashboard.

## References

- [R2 public access settings](https://developers.cloudflare.com/r2/buckets/public-buckets/)
- [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- [R2 uploads](https://developers.cloudflare.com/r2/objects/upload-objects/)

## Current local publishing commands

The gallery groups alternate views into items using `scripts/group-artwork.mjs`. Its reviewed aliases join differently named views of the same work, and its descriptions provide context without inventing prices or availability. The 209 archive entries currently form 57 items with 204 distinct views. Byte-identical display views within an item appear only once. Different works inspired by the same character remain separate unless explicitly grouped.

`art/gallery.json` remains the protected-image inventory; `art/items.json` is the grouped catalog used by the site. Both reference only approved display copies. The build regenerates the grouped catalog and verifies that grouping loses no image hashes, mixes no fan-art classification, and exposes no unapproved view. Grouping does not modify or remove source files or display files.

For future custom entries in the external `artwork.local.json`, use the same `itemId` on multiple views of one item, and add a `description`. Use a different `itemId` for separate items that happen to share a title. `python scripts/publish-artwork.py` regenerates both manifests; to edit grouping or descriptions for existing archive entries, update `scripts/group-artwork.mjs` and run `node scripts/group-artwork.mjs`.

Install Pillow (`python -m pip install Pillow`) if needed, then run:

```powershell
python scripts/publish-artwork.py --source "../Lakeland art"
node scripts/check-artwork.mjs
npm.cmd run deploy:cloudflare
```

The script imports the extracted Whimsy manifest, top-level JPG/PNG files, and Beekeeper mug mockups. To add other work, create `artwork.local.json` inside the **external Lakeland art folder** using the example in the script docstring. Use `sculpture: true` only for sculpture-only photographs; the default applies a watermark. Inspect display copies before deployment.

The public manifest at `wwwroot/art/gallery.json` contains display metadata and derivative checksums only. The private source audit is in ignored `artifacts/art-publishing/private-source-manifest.json`; never publish it. Public display copies may be included with shared source, but the artwork remains separately copyrighted. The build checks that raster files are cataloged, checksums match, and non-sculpture entries require watermarks. These checks are guardrails against accidental inclusion, not an independent visual watermark detector or a security boundary against a malicious developer changing the manifest.

Originals are never overwritten. Artwork removed from the manifest must also have its old display copy removed from `wwwroot/art/display` before deployment; the check rejects stale, uncataloged files. Re-running the publisher with changed watermark settings similarly requires reviewing and removing old derivatives. The script does not delete files automatically.
