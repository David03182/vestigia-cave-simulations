const chunkSize = 4 * 1024 * 1024;
const parallelChunks = 4;

function scanLength(bytes) {
  const header = new DataView(bytes);
  if (bytes.byteLength < 20 || header.getUint32(0, true) !== 0x46546c67
      || header.getUint32(4, true) !== 2) {
    throw new Error('Invalid glTF scan header');
  }
  return header.getUint32(8, true);
}

async function downloadChunk(url, start, end, total) {
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(url, {
        headers: { Range: `bytes=${start}-${end}` },
        cache: attempt ? 'reload' : 'default',
        signal: controller.signal
      });
      if (response.status !== 206 && !(start === 0 && response.status === 200)) {
        throw new Error(`Scan download returned HTTP ${response.status}`);
      }
      const bytes = await response.arrayBuffer();
      if (response.status === 200) {
        if (scanLength(bytes) !== bytes.byteLength) throw new Error('Incomplete scan download');
        return { bytes, total: bytes.byteLength };
      }
      const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('Content-Range') ?? '');
      const length = range ? Number(range[3]) : 0;
      const last = Math.min(end, length - 1);
      if (!range || Number(range[1]) !== start || Number(range[2]) !== last
          || bytes.byteLength !== last - start + 1
          || (start === 0 ? scanLength(bytes) !== length : length !== total)) {
        throw new Error('Incomplete or invalid scan download');
      }
      return { bytes, total: length };
    } catch (error) {
      if (attempt === 2) throw error;
    } finally {
      clearTimeout(timeout);
    }
    await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)));
  }
}

export async function downloadScan(url) {
  const first = await downloadChunk(url, 0, chunkSize - 1);
  if (first.bytes.byteLength === first.total) return first.bytes;
  const scan = new Uint8Array(first.total);
  scan.set(new Uint8Array(first.bytes));
  for (let offset = first.bytes.byteLength; offset < first.total; offset += chunkSize * parallelChunks) {
    const batch = [];
    for (let start = offset; start < Math.min(first.total, offset + chunkSize * parallelChunks); start += chunkSize) {
      const end = Math.min(start + chunkSize, first.total) - 1;
      batch.push(downloadChunk(url, start, end, first.total).then(({ bytes }) => {
        scan.set(new Uint8Array(bytes), start);
      }));
    }
    await Promise.all(batch);
  }
  return scan.buffer;
}
