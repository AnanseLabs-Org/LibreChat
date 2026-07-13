const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const brandingDir = path.join(rootDir, 'branding');
const exampleDir = path.join(rootDir, 'branding.example');
const envPath = path.join(rootDir, '.env');

const publicDir = path.join(rootDir, 'client', 'public');
const assetsDir = path.join(publicDir, 'assets');

// Helper to copy file if exists
function copyFile(srcName, destPath) {
  const srcPath = path.join(brandingDir, srcName);
  if (fs.existsSync(srcPath)) {
    // Ensure destination directory exists
    const destDir = path.dirname(destPath);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    fs.copyFileSync(srcPath, destPath);
    console.log(`[Branding Sync] Copied ${srcName} -> ${path.relative(rootDir, destPath)}`);
  }
}

// Helper to copy directory recursively
function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function updateEnv(envPath, config) {
  let envContent = '';
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
  }

  let lines = envContent.split(/\r?\n/);
  for (const [key, value] of Object.entries(config)) {
    let found = false;
    const regex = new RegExp(`^\\s*${key}\\s*=`);
    // Format the value: wrap in double quotes if it contains spaces and is not already quoted
    const formattedValue = value.includes(' ') && !value.startsWith('"') && !value.startsWith("'") 
      ? `"${value}"` 
      : value;

    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) {
        lines[i] = `${key}=${formattedValue}`;
        found = true;
        break;
      }
    }
    if (!found) {
      lines.push(`${key}=${formattedValue}`);
    }
  }

  fs.writeFileSync(envPath, lines.join('\n'), 'utf8');
  console.log('[Branding Sync] Updated .env configuration keys');
}

function main() {
  console.log('[Branding Sync] Starting synchronization...');

  // 1. If branding directory does not exist, bootstrap from example
  if (!fs.existsSync(brandingDir)) {
    console.log('[Branding Sync] branding/ directory not found. Bootstrapping from branding.example/');
    if (fs.existsSync(exampleDir)) {
      copyDirSync(exampleDir, brandingDir);
      console.log('[Branding Sync] Successfully bootstrapped branding/');
    } else {
      console.error('[Branding Sync] Error: branding.example/ template directory not found.');
      process.exit(1);
    }
  }

  // 2. Sync Assets to client/public
  copyFile('favicon.ico', path.join(publicDir, 'favicon.ico'));
  copyFile('logo.svg', path.join(assetsDir, 'logo.svg'));
  copyFile('favicon-16x16.png', path.join(assetsDir, 'favicon-16x16.png'));
  copyFile('favicon-32x32.png', path.join(assetsDir, 'favicon-32x32.png'));
  copyFile('apple-touch-icon.png', path.join(assetsDir, 'apple-touch-icon.png'));
  copyFile('android-chrome-192x192.png', path.join(assetsDir, 'android-chrome-192x192.png'));
  copyFile('android-chrome-512x512.png', path.join(assetsDir, 'android-chrome-512x512.png'));

  // 3. Update .env variables from branding.json
  const configJsonPath = path.join(brandingDir, 'branding.json');
  if (fs.existsSync(configJsonPath)) {
    try {
      const configData = fs.readFileSync(configJsonPath, 'utf8');
      const config = JSON.parse(configData);
      updateEnv(envPath, config);
    } catch (err) {
      console.error('[Branding Sync] Failed to parse branding.json:', err.message);
    }
  }

  console.log('[Branding Sync] Finished successfully!');
}

main();
