#!/usr/bin/env node
// Downloads 2K planet textures from Solar System Scope (CC BY 4.0,
// https://www.solarsystemscope.com/textures/) into apps/web/public/textures.
// Textures are based on NASA imagery; attribution lives in public/data/attributions.json.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'apps/web/public/textures/planets');
const BASE = 'https://www.solarsystemscope.com/textures/download/';

const FILES = [
  '2k_sun.jpg', '2k_mercury.jpg', '2k_venus_atmosphere.jpg', '2k_earth_daymap.jpg',
  '2k_earth_nightmap.jpg', '2k_earth_clouds.jpg', '2k_moon.jpg', '2k_mars.jpg', '2k_jupiter.jpg',
  '2k_saturn.jpg', '2k_saturn_ring_alpha.png', '2k_uranus.jpg', '2k_neptune.jpg',
];

mkdirSync(outDir, { recursive: true });
for (const f of FILES) {
  const dest = resolve(outDir, f);
  if (existsSync(dest)) continue;
  const res = await fetch(BASE + f);
  if (!res.ok) {
    console.error(`  ${f}: HTTP ${res.status}`);
    process.exitCode = 1;
    continue;
  }
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  console.log(`  ${f}`);
}
