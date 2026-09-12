import { fileURLToPath } from 'node:url';

// Native Node loader; real environment variables take precedence over .env.
try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
