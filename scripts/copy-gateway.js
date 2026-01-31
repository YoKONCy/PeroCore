const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DEST_DIR = path.join(__dirname, '../resources/bin');
const GATEWAY_SRC_DIR = path.join(__dirname, '../gateway'); // Internal gateway source
const GATEWAY_SRC_FILE = path.join(GATEWAY_SRC_DIR, 'gateway.exe');
const GATEWAY_DEST_FILE = path.join(DEST_DIR, 'gateway.exe');

console.log('Checking Gateway binary...');

// Ensure destination exists
if (!fs.existsSync(DEST_DIR)) {
    fs.mkdirSync(DEST_DIR, { recursive: true });
}

console.log('Building/Copying gateway from internal source:', GATEWAY_SRC_DIR);

if (fs.existsSync(path.join(GATEWAY_SRC_DIR, 'gateway/main.go'))) {
    try {
        console.log('Running go build...');
        // Build directly to destination
        execSync(`go build -o "${GATEWAY_DEST_FILE}" ./gateway`, { cwd: GATEWAY_SRC_DIR, stdio: 'inherit' });
        
        if (fs.existsSync(GATEWAY_DEST_FILE)) {
            console.log('Build successful! Gateway placed at:', GATEWAY_DEST_FILE);
        } else {
            console.error('Build failed to produce gateway.exe');
            process.exit(1);
        }
    } catch (e) {
        console.error('Failed to build gateway:', e.message);
        process.exit(1);
    }
} else {
    console.error('Gateway source not found at ' + GATEWAY_SRC_DIR);
    process.exit(1);
}
