import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isWindows = process.platform === 'win32';
const binaryName = isWindows ? 'yt-dlp.exe' : 'yt-dlp';
const YTDLP_PATH = path.join(__dirname, 'node_modules', 'yt-dlp-exec', 'bin', binaryName);
const YTDLP_URL = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${binaryName}`;

console.log('\n🔄 Updating yt-dlp to the latest version...');
console.log(`📍 Platform: ${process.platform}`);
console.log(`📍 Binary: ${binaryName}`);
console.log(`📍 Target path: ${YTDLP_PATH}\n`);

async function update() {
    try {
        // Ensure directory exists
        const binDir = path.dirname(YTDLP_PATH);
        if (!fs.existsSync(binDir)) {
            fs.mkdirSync(binDir, { recursive: true });
            console.log('✓ Created bin directory');
        }

        // Backup if exists
        if (fs.existsSync(YTDLP_PATH)) {
            try {
                fs.copyFileSync(YTDLP_PATH, YTDLP_PATH + '.backup');
                console.log('✓ Backed up existing binary');
            } catch (e) {
                console.log('⚠ Could not backup, proceeding...');
            }
        }

        console.log('⬇ Downloading from GitHub...');
        const response = await fetch(YTDLP_URL);

        if (!response.ok) {
            throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        fs.writeFileSync(YTDLP_PATH, buffer);

        // Set permissions
        if (!isWindows) {
            try {
                fs.chmodSync(YTDLP_PATH, 0o755);
            } catch (e) {
                // ignore
            }
        }

        console.log('\n✅ yt-dlp updated successfully!');
        console.log(`✓ Size: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);

    } catch (error) {
        console.error('\n✗ FATAL ERROR:', error.message);
        process.exit(1);
    }
}

update();
