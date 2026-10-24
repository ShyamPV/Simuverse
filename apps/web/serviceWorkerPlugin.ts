import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Builds sw.js from sw.template.js: the precache list is the app shell (every
 * emitted JS/CSS file) plus the core data: the files directly in public/data,
 * the planet textures, the Milky Way panorama, the image index and atlas, the
 * star-tile index, and the ephemeris chunk covering the build date. The
 * version is a hash of all their contents, so any change installs a new worker.
 */
export function serviceWorker(): Plugin {
  let publicDir = '';
  let root = '';
  return {
    name: 'simuverse-service-worker',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      publicDir = config.publicDir;
      root = config.root;
    },
    generateBundle(_options, bundle) {
      const hash = createHash('sha256');
      const shell = Object.keys(bundle).filter((f) => !f.endsWith('.map') && f !== 'sw.js').sort();
      for (const f of shell) {
        const out = bundle[f]!;
        hash.update(f).update(out.type === 'chunk' ? out.code : out.source);
      }
      const data = coreData(publicDir);
      for (const f of data) hash.update(f).update(readFileSync(join(publicDir, f)));
      const precache = ['index.html', ...shell.filter((f) => f !== 'index.html'), ...data];
      const template = readFileSync(join(root, 'sw.template.js'), 'utf8');
      hash.update(template);
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: template
          .replace('__VERSION__', JSON.stringify(hash.digest('hex').slice(0, 12)))
          .replace('__PRECACHE__', JSON.stringify(precache)),
      });
    },
  };
}

function coreData(publicDir: string): string[] {
  const files = (dir: string, recursive = false): string[] =>
    readdirSync(join(publicDir, dir)).flatMap((name) => {
      const path = `${dir}/${name}`;
      if (statSync(join(publicDir, path)).isDirectory()) return recursive ? files(path, true) : [];
      return [path];
    });
  const manifest = JSON.parse(readFileSync(join(publicDir, 'data/ephem/manifest.json'), 'utf8')) as {
    blocks: { file: string; startYear: number; endYear: number }[];
  };
  const year = new Date().getUTCFullYear();
  const block = manifest.blocks.find((b) => year >= b.startYear && year < b.endYear) ?? manifest.blocks.at(-1)!;
  const out = [
    'favicon.svg',
    ...files('icons'),
    'manifest.webmanifest',
    ...files('data'),
    'data/ephem/manifest.json',
    `data/ephem/${block.file}`,
    ...files('data/milkyway'),
    'data/stars/index.json',
    'data/images/index.json',
    'data/images/atlas.jpg',
    ...files('textures', true),
  ];
  return out.map((f) => relative(publicDir, join(publicDir, f)).replaceAll('\\', '/'));
}
