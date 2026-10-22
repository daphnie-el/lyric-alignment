import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DB_PATH = process.env.DB_PATH || join(ROOT, 'data', 'track.db');
export const PUBLIC_DIR = join(ROOT, 'public');
export const UPLOAD_DIR = process.env.UPLOAD_DIR || join(dirname(DB_PATH), 'uploads');
export const MAX_AUDIO_BYTES = 100 * 1024 * 1024;
export const PORT = Number(process.env.PORT || 4000);
export const HOST = process.env.HOST || '0.0.0.0';

/** The one token. Also printed in the README. */
export const AUTH_TOKEN = process.env.API_TOKEN || 'lyric-align-dev-token-7f3a91';

export const MAX_BODY_BYTES = 2 * 1024 * 1024;
