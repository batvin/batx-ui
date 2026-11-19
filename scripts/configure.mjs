import { randomBytes } from 'node:crypto';
import { closeSync, fsyncSync, openSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envPath = fileURLToPath(new URL('../.env', import.meta.url));

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error('Setup requires an interactive terminal. Use docker run --rm -it, and do not redirect output. No .env file was created.');
  process.exitCode = 1;
} else {
  let descriptor;
  try {
    const password = randomBytes(32).toString('base64url');
    const contents = [
      'ADMIN_USERNAME=admin',
      `ADMIN_PASSWORD=${password}`,
      'HOST=127.0.0.1',
      'PORT=8787',
      'DATA_DIR=./data',
      'COOKIE_SECURE=false',
      'TRUST_PROXY=false',
      'PUBLIC_ORIGIN=',
      'BATX_DOMAIN=',
      '',
    ].join('\n');

    descriptor = openSync(envPath, 'wx', 0o600);
    writeFileSync(descriptor, contents, 'utf8');
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;

    console.log(`Created ${envPath} without overwriting an existing file.`);
    console.log('First-run administrator credentials (store in a password manager):');
    console.log('Username: admin');
    console.log(`Password: ${password}`);
    console.log('These initialize a new data directory only; editing .env does not reset an existing administrator.');
    console.log('Do not commit .env or share this terminal output. Keep this file readable only by its owner.');
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    console.error(error.code === 'EEXIST'
      ? 'Refusing to overwrite .env. Keep the existing configuration and credentials.'
      : `Setup failed (${error.code || 'error'}). Inspect .env before retrying; existing files are never overwritten.`);
    process.exitCode = 1;
  }
}
