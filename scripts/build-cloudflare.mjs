import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const project = 'src/Lakeland.OrderFulfilment.Api';
execFileSync(process.execPath, ['scripts/group-artwork.mjs'], { cwd: root, stdio: 'inherit' });
execFileSync(process.execPath, ['scripts/check-artwork.mjs'], { cwd: root, stdio: 'inherit' });
execFileSync('dotnet', ['build', project, '--configuration', 'Release', '--nologo'], { cwd: root, stdio: 'inherit' });
const exported = execFileSync('dotnet', [`${project}/bin/Release/net10.0/Lakeland.OrderFulfilment.Api.dll`, '--export-beta-catalog'], { cwd: root, encoding: 'utf8' });
const catalog = JSON.parse(exported);
if (!Array.isArray(catalog.products) || !Array.isArray(catalog.gallery)) throw new Error('Invalid preview catalog export.');
mkdirSync(new URL('../cloudflare/', import.meta.url), { recursive: true });
writeFileSync(new URL('../cloudflare/catalog.generated.json', import.meta.url), JSON.stringify(catalog, null, 2) + '\n');
console.log(`Exported ${catalog.products.length} sample products and ${catalog.gallery.length} gallery works from the .NET catalog.`);
