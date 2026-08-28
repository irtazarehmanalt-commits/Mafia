/**
 * Downloads the game's background and role artwork into apps/web/public.
 *
 * The images are vendored rather than hot-linked so the app has no runtime
 * dependency on a third-party CDN. See apps/web/public/images/CREDITS.md.
 *
 * Usage: npm run assets:fetch
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'apps', 'web', 'public', 'images');

const ASSETS = [
  { file: 'hero-noir.jpg', id: 'photo-1641317113954-c51a2d66f5df', width: 2000 },
  { file: 'lobby-street.jpg', id: 'photo-1648504149855-26e9fe360dea', width: 1800 },
  { file: 'night-moon.jpg', id: 'photo-1507502707541-f369a3b18502', width: 1800 },
  { file: 'day-mist.jpg', id: 'photo-1553696211-c396d7be9db9', width: 1800 },
  { file: 'dusk-vote.jpg', id: 'photo-1585817934451-158d9f444228', width: 1800 },
  { file: 'gameover-fog.jpg', id: 'photo-1676493172304-5243482241fe', width: 1800 },
  { file: 'smoke.jpg', id: 'photo-1585644156378-72d15fa33be5', width: 1400 },
  { file: 'grain.jpg', id: 'photo-1670056763246-d2782ba17fe0', width: 1200 },
  { file: 'roles/mafia.jpg', id: 'photo-1777135434585-10682a442b1f', width: 900 },
  { file: 'roles/detective.jpg', id: 'photo-1767169720650-a332388d9da6', width: 900 },
  { file: 'roles/doctor.jpg', id: 'photo-1764345676856-eaf84d541dc9', width: 900 },
  { file: 'roles/civilian.jpg', id: 'photo-1773083405815-34ea5253db0b', width: 900 },
];

let failures = 0;

for (const asset of ASSETS) {
  const url = `https://images.unsplash.com/${asset.id}?auto=format&fit=crop&w=${asset.width}&q=72`;
  const dest = join(outDir, asset.file);
  try {
    await mkdir(dirname(dest), { recursive: true });
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    await writeFile(dest, buffer);
    console.log(`OK    ${asset.file.padEnd(24)} ${Math.round(buffer.length / 1024)} KB`);
  } catch (err) {
    failures++;
    console.error(`FAIL  ${asset.file.padEnd(24)} ${err.message}`);
  }
}

process.exit(failures === 0 ? 0 : 1);
