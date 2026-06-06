const path = require('path');
const fs = require('fs');

async function main() {
  let sharp;
  try { sharp = require('sharp'); } catch { console.error('sharp not installed'); process.exit(1); }

  const searches = [
    path.join(__dirname, '..', 'logo3.png'),
    path.join(__dirname, '..', 'logo3.jpeg'),
    path.join(__dirname, '..', 'logo3.jpg'),
    path.join(process.env.USERPROFILE || '', 'Desktop', 'logo3.png'),
    path.join(process.env.USERPROFILE || '', 'Desktop', 'logo3.jpeg'),
    path.join(process.env.USERPROFILE || '', 'Desktop', 'logo3.jpg'),
  ];

  let src = searches.find(p => fs.existsSync(p));
  if (!src) { console.error('logo3 not found'); process.exit(1); }
  console.log('Found:', src);

  const sizes = [16, 32, 48, 64, 128, 256];
  const apps = ['admin-app', 'scheduling-app', 'technician-app', 'unified-app'];

  for (const app of apps) {
    const assetsDir = path.join(__dirname, '..', 'packages', app, 'assets');
    if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

    // Generate 256px PNG for app use
    const png256 = await sharp(src)
      .resize(256, 256, { fit: 'contain', background: { r:0,g:0,b:0,alpha:0 } })
      .png().toBuffer();
    fs.writeFileSync(path.join(assetsDir, 'icon.png'), png256);

    // Generate multi-size ICO manually
    const pngBuffers = [];
    for (const size of sizes) {
      const buf = await sharp(src)
        .resize(size, size, { fit: 'contain', background: { r:0,g:0,b:0,alpha:0 } })
        .png().toBuffer();
      pngBuffers.push(buf);
    }

    const icoBuffer = buildIco(pngBuffers, sizes);
    fs.writeFileSync(path.join(assetsDir, 'icon.ico'), icoBuffer);
    console.log('OK:', app, `(${icoBuffer.length} bytes)`);
  }
}

function buildIco(pngBuffers, sizes) {
  const count = pngBuffers.length;
  const headerSize = 6;
  const dirEntrySize = 16;
  const dirSize = headerSize + dirEntrySize * count;

  let totalSize = dirSize;
  for (const buf of pngBuffers) totalSize += buf.length;

  const ico = Buffer.alloc(totalSize);
  // ICONDIR header
  ico.writeUInt16LE(0, 0);      // reserved
  ico.writeUInt16LE(1, 2);      // type: 1 = ICO
  ico.writeUInt16LE(count, 4);  // count

  let dataOffset = dirSize;
  for (let i = 0; i < count; i++) {
    const size = sizes[i];
    const buf = pngBuffers[i];
    const entryOffset = headerSize + i * dirEntrySize;
    ico.writeUInt8(size === 256 ? 0 : size, entryOffset);     // width (0 = 256)
    ico.writeUInt8(size === 256 ? 0 : size, entryOffset + 1); // height (0 = 256)
    ico.writeUInt8(0, entryOffset + 2);   // color count
    ico.writeUInt8(0, entryOffset + 3);   // reserved
    ico.writeUInt16LE(1, entryOffset + 4); // color planes
    ico.writeUInt16LE(32, entryOffset + 6); // bits per pixel
    ico.writeUInt32LE(buf.length, entryOffset + 8);  // size
    ico.writeUInt32LE(dataOffset, entryOffset + 12); // offset
    buf.copy(ico, dataOffset);
    dataOffset += buf.length;
  }
  return ico;
}

main().catch(e => { console.error(e); process.exit(1); });