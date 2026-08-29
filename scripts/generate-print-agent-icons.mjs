import { execSync } from 'node:child_process';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const printAgentDir = resolve(rootDir, 'apps/print-agent');
const buildDir = resolve(printAgentDir, 'build');
const sourcePng = resolve(printAgentDir, 'src/desktop/assets/icon.png');
const masterPng = resolve(buildDir, 'icon.png');

function createIcoFromPngs(pngBuffers) {
  const count = pngBuffers.length;
  const headerSize = 6;
  const dirEntrySize = 16;
  let offset = headerSize + dirEntrySize * count;

  const entries = [];
  for (const { width, height, buffer } of pngBuffers) {
    const entry = Buffer.alloc(dirEntrySize);
    entry.writeUInt8(width >= 256 ? 0 : width, 0);
    entry.writeUInt8(height >= 256 ? 0 : height, 1);
    entry.writeUInt8(0, 2); // color count
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(buffer.length, 8); // image size
    entry.writeUInt32LE(offset, 12); // offset
    entries.push(entry);
    offset += buffer.length;
  }

  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // icon type (1)
  header.writeUInt16LE(count, 4); // count

  return Buffer.concat([header, ...entries, ...pngBuffers.map((p) => p.buffer)]);
}

async function main() {
  await mkdir(buildDir, { recursive: true });
  await copyFile(sourcePng, masterPng);

  const sizes = [16, 32, 48, 64, 128, 256];
  const pngBuffers = [];

  for (const size of sizes) {
    const tempPath = resolve(buildDir, `temp_${size}.png`);
    execSync(`sips -z ${size} ${size} "${masterPng}" --out "${tempPath}"`, { stdio: 'ignore' });
    const buffer = await readFile(tempPath);
    pngBuffers.push({ width: size, height: size, buffer });
    await rm(tempPath, { force: true });
  }

  // Generate ICO
  const icoBuffer = createIcoFromPngs(pngBuffers);
  await writeFile(resolve(buildDir, 'icon.ico'), icoBuffer);
  console.log('✓ Generated build/icon.ico');

  // Generate ICNS using iconutil on macOS
  const iconsetDir = resolve(buildDir, 'icon.iconset');
  await rm(iconsetDir, { recursive: true, force: true });
  await mkdir(iconsetDir, { recursive: true });

  const iconsetSpecs = [
    { name: 'icon_16x16.png', size: 16 },
    { name: 'icon_16x16@2x.png', size: 32 },
    { name: 'icon_32x32.png', size: 32 },
    { name: 'icon_32x32@2x.png', size: 64 },
    { name: 'icon_128x128.png', size: 128 },
    { name: 'icon_128x128@2x.png', size: 256 },
    { name: 'icon_256x256.png', size: 256 },
    { name: 'icon_256x256@2x.png', size: 512 },
    { name: 'icon_512x512.png', size: 512 },
    { name: 'icon_512x512@2x.png', size: 1024 },
  ];

  for (const spec of iconsetSpecs) {
    execSync(
      `sips -z ${spec.size} ${spec.size} "${masterPng}" --out "${resolve(iconsetDir, spec.name)}"`,
      {
        stdio: 'ignore',
      },
    );
  }

  const icnsPath = resolve(buildDir, 'icon.icns');
  execSync(`iconutil -c icns "${iconsetDir}" -o "${icnsPath}"`);
  await rm(iconsetDir, { recursive: true, force: true });
  console.log('✓ Generated build/icon.icns');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
