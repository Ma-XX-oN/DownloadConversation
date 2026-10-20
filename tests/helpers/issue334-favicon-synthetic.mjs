import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function chunk(kind, bytes) {
  const name = Buffer.from(kind);
  const header = Buffer.alloc(4);
  header.writeUInt32BE(bytes.length);
  const data = Buffer.concat([name, bytes]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(data));
  return Buffer.concat([header, data, tail]);
}
export function png({ badDecode = false } = {}) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const data = deflateSync(Buffer.from([0, 255, 128, 64, 255]));
  if (badDecode) data.fill(0); // CRC remains valid but zlib IDAT cannot decode.
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', data), chunk('IEND', Buffer.alloc(0))]);
}
export function syntheticPack({ corrupt = false, badDimensions = false, badOffset = false, badDecode = false } = {}) {
  const icon = png({ badDecode });
  const images = [];
  let offset = 0;
  for (let base = 0; base < 4; base++) {
    const pies = [];
    for (let step = 0; step < 7; step++) {
      const pulses = [];
      for (let pulse = 0; pulse < 21; pulse++) {
        pulses.push({ bytes: icon.length, offset });
        offset += icon.length;
      }
      pies.push(pulses);
    }
    images.push(pies);
  }
  if (badOffset) images[2][3][4].offset += 1;
  const manifest = { schema: 'dc-favicon-pack-v1', variants: [{ height: badDimensions ? 2 : 1, id: '0', images, source_sha256: 'a'.repeat(64), width: 1 }] };
  const header = Buffer.from(JSON.stringify(manifest));
  const prefix = Buffer.alloc(12);
  prefix.write('DCFC0001');
  prefix.writeUInt32LE(header.length, 8);
  const body = Buffer.concat(Array(588).fill(icon));
  if (corrupt) body[12] ^= 0x20;
  const pack = Buffer.concat([prefix, header, body]);
  return { pack, sha256: createHash('sha256').update(pack).digest('hex') };
}
export function catalogue(pack, versions = ['1.11.7']) {
  return { schema: 'dc-favicon-catalogue-v1', datasets: versions.map(version => ({ version, update_every_ms: 250, favicons: { commit: 'a'.repeat(40), path: 'assets/favicons/v1/synthetic.dcfav', bytes: pack.pack.length, sha256: pack.sha256 } })) };
}