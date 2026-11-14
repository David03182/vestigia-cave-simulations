import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { downloadScan } from '../src/scan-download.js';

const manifest = JSON.parse(await readFile(new URL('../assets.json', import.meta.url), 'utf8'));

async function checksum(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

for (const asset of manifest.files) {
  const target = resolve('public', asset.path);
  const staged = target + '.download';
  const existing = await checksum(target).catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (existing === asset.sha256) {
    console.log('Already verified:', asset.path);
    continue;
  }
  await mkdir(dirname(target), { recursive: true });
  console.log('Downloading:', asset.path);
  try {
    const url = new URL(asset.path, manifest.origin);
    if (asset.path.endsWith('.glb')) {
      let scan;
      try {
        scan = await downloadScan(url);
      } catch {
        // Retry with a fresh cache key if an upstream range was incomplete.
        url.searchParams.set('download', randomUUID());
        scan = await downloadScan(url);
      }
      await writeFile(staged, new Uint8Array(scan));
    } else {
      const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${asset.path}`);
      await pipeline(Readable.fromWeb(response.body), createWriteStream(staged));
    }
    if (await checksum(staged) !== asset.sha256) {
      throw new Error(`Unexpected contents for ${asset.path}. Check the asset version against Vestigia.`);
    }
    await rename(staged, target);
  } finally {
    await rm(staged, { force: true });
  }
}
