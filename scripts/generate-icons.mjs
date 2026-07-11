import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

const require = createRequire(import.meta.url);
const png2icons = require('png2icons');
const directory = path.join(process.cwd(), 'assets', 'icons');
const input = readFileSync(path.join(directory, 'pax-localia.png'));
const ico = png2icons.createICO(input, png2icons.BICUBIC2, 0, false, true);
const icns = png2icons.createICNS(input, png2icons.BICUBIC2, 0);
if (!ico || !icns) throw new Error('Could not generate desktop icon formats.');
writeFileSync(path.join(directory, 'pax-localia.ico'), ico);
writeFileSync(path.join(directory, 'pax-localia.icns'), icns);
console.log('Generated Windows ICO and macOS ICNS application icons.');
