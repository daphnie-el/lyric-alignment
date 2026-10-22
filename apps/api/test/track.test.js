import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { request } from 'node:http';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';

const token = 'api-integration-test';
const headers = { Authorization: `Bearer ${token}` };
// A valid short mono PCM WAV, independent of the bundled demo.
const wav = Buffer.alloc(44 + 1600);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4);
wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(1600, 40);

test('single current track API and streamed audio storage', { timeout: 60000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lyric-track-test-'));
  const dbPath = join(directory, 'test.db');
  const uploads = join(directory, 'uploads');
  let server;
  let base;
  let logs = '';
  async function start(extra = {}) {
    server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'apps/api/src/server.js'], {
      env: { ...process.env, PORT: '0', HOST: '127.0.0.1', DB_PATH: dbPath, UPLOAD_DIR: uploads, API_TOKEN: token, SEED_ON_START: 'false', ...extra },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Server did not start: ${logs}`)), 10000);
      server.stdout.on('data', (chunk) => {
        logs += chunk;
        const port = String(chunk).match(/localhost:(\d+)/)?.[1];
        if (port) { base = `http://127.0.0.1:${port}`; clearTimeout(timer); resolve(); }
      });
      server.stderr.on('data', (chunk) => { logs += chunk; });
      server.once('error', (error) => { clearTimeout(timer); reject(error); });
      server.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${logs}`)); });
    });
  }
  async function stop() {
    if (server && server.exitCode === null) {
      const exited = once(server, 'exit');
      server.kill('SIGTERM');
      await exited;
    }
  }
  const get = () => fetch(`${base}/api/v1/track`, { headers });
  const post = (body, extraHeaders = {}) => fetch(`${base}/api/v1/track`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', ...extraHeaders }, body: JSON.stringify(body),
  });
  const put = (body) => fetch(`${base}/api/v1/track/alignment`, {
    method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const urlBody = { audio_url: 'https://example.com/My%20Song.mp3?token=abc', duration_seconds: 12.5 };
  function upload({ data = wav, filename = 'New song.wav', duration = '0.1', title } = {}) {
    const body = new FormData();
    body.append('file', new Blob([data]), filename);
    body.append('duration_seconds', duration);
    if (title !== undefined) body.append('title', title);
    return fetch(`${base}/api/v1/track`, { method: 'POST', headers, body });
  }
  async function eventually(check) {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await check()) return;
      await delay(20);
    }
    assert.fail('Condition did not become true');
  }
  let current;
  try {
    await start();
    await t.test('empty state, authentication, and POST CORS support', async () => {
      const empty = await get();
      assert.equal(empty.status, 404);
      assert.equal((await empty.json()).error, 'no_current_track');
      const unauthorized = await fetch(`${base}/api/v1/track`, { method: 'POST' });
      assert.equal(unauthorized.status, 401);
      const options = await fetch(`${base}/api/v1/track`, { method: 'OPTIONS' });
      assert.match(options.headers.get('access-control-allow-methods'), /POST/);
    });
    await t.test('URL creation returns an empty persisted sheet without fetching the URL', async () => {
      const response = await post(urlBody);
      assert.equal(response.status, 201);
      current = await response.json();
      assert.deepEqual(current, { id: '1', title: 'My Song', artist: '', ...urlBody, lines: [], version: 0, alignment: null });
      assert.deepEqual(await (await get()).json(), current);
      await stop(); await start({ SEED_ON_START: 'true' });
      assert.deepEqual(await (await get()).json(), current);
    });
    await t.test('invalid URL, metadata, and content types preserve current state', async () => {
      for (const body of [
        { ...urlBody, audio_url: 'file:///tmp/audio.mp3' },
        { ...urlBody, audio_url: 'https://user:secret@example.com/audio.mp3' },
        { ...urlBody, audio_url: 'bad url' },
        { ...urlBody, duration_seconds: 0 }, { ...urlBody, duration_seconds: '12' },
        { ...urlBody, title: 'x'.repeat(256) }, { ...urlBody, title: 'bad\nname' },
      ]) assert.equal((await post(body)).status, 400);
      assert.equal((await fetch(`${base}/api/v1/track`, { method: 'POST', headers, body: 'text' })).status, 415);
      assert.deepEqual(await (await get()).json(), current);
    });
    await t.test('saving uses track identity and accepts an empty lyric sheet', async () => {
      const response = await put({ track_id: current.id, version: 0, lines: [], segments: [] });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).version, 1);
      const missing = await put({ version: 1, lines: [], segments: [] });
      assert.equal(missing.status, 400);
      const saved = await put({ track_id: current.id, version: 1, lines: [{ id: 'old', index: 0, text: 'Old lyric' }], segments: [] });
      assert.equal(saved.status, 200);
    });
    await t.test('file uploads accept the optional title as a third multipart part', async () => {
      const response = await upload({ title: 'Custom song title' });
      assert.equal(response.status, 201);
      current = await response.json();
      assert.equal(current.title, 'Custom song title');
      assert.equal((await readdir(uploads)).length, 1);
    });
    await t.test('UTF-8 filenames produce intact titles and explicit titles still take precedence', async () => {
      const response = await upload({ filename: 'Cântec 夜 🌙.wav' });
      assert.equal(response.status, 201);
      current = await response.json();
      assert.equal(current.title, 'Cântec 夜 🌙');
      const overridden = await upload({ filename: 'Cântec 夜 🌙.wav', title: 'Titlu ales' });
      assert.equal(overridden.status, 201);
      current = await overridden.json();
      assert.equal(current.title, 'Titlu ales');
      assert.equal((await readdir(uploads)).length, 1);
    });
    await t.test('extra multipart fields, duplicate metadata, and multiple files still fail and clean up', async () => {
      for (const kind of ['extra-field', 'duplicate', 'extra-file']) {
        const body = new FormData();
        body.append('file', new Blob([wav]), 'song.wav');
        body.append('duration_seconds', '0.1');
        body.append('title', 'Valid title');
        if (kind === 'extra-field') body.append('extra', 'not allowed');
        else if (kind === 'duplicate') body.append('duration_seconds', '0.2');
        else body.append('file', new Blob([wav]), 'another.wav');
        const response = await fetch(`${base}/api/v1/track`, { method: 'POST', headers, body });
        assert.equal(response.status, 400);
        assert.deepEqual(await (await get()).json(), current);
        assert.equal((await readdir(uploads)).length, 1);
      }
    });
    await t.test('file upload replaces prior lyrics and versions, supports ranges and restart', async () => {
      const response = await upload();
      assert.equal(response.status, 201);
      const previousId = current.id;
      current = await response.json();
      assert.notEqual(current.id, previousId);
      assert.equal(current.title, 'New song');
      assert.equal(current.version, 0);
      assert.deepEqual(current.lines, []);
      assert.equal(current.alignment, null);
      assert.match(current.audio_url, /^\/api\/audio\/uploads\/[0-9a-f-]+\.wav$/);
      const stale = await put({ track_id: previousId, version: 0, lines: [], segments: [] });
      assert.equal(stale.status, 409);
      assert.equal((await stale.json()).error, 'track_conflict');
      const full = await fetch(base + current.audio_url);
      assert.equal(full.headers.get('content-type'), 'audio/wav');
      assert.deepEqual(Buffer.from(await full.arrayBuffer()), wav);
      for (const [range, start, end] of [['bytes=10-19', 10, 20], ['bytes=40-', 40, wav.length], ['bytes=-8', wav.length - 8, wav.length]]) {
        const audio = await fetch(base + current.audio_url, { headers: { Range: range } });
        assert.equal(audio.status, 206);
        assert.deepEqual(Buffer.from(await audio.arrayBuffer()), wav.subarray(start, end));
      }
      assert.equal((await fetch(base + current.audio_url, { headers: { Range: 'bytes=999999-' } })).status, 416);
      const db = new DatabaseSync(dbPath);
      assert.equal(db.prepare('SELECT count(*) AS n FROM tracks').get().n, 1);
      assert.equal(db.prepare('SELECT count(*) AS n FROM alignments').get().n, 0);
      db.close();
      await stop(); await start();
      assert.deepEqual(await (await get()).json(), current);
      assert.equal((await fetch(base + current.audio_url)).status, 200);
    });
    await t.test('reusing the current upload by an absolute URL keeps it playable through restart', async () => {
      const audioPath = current.audio_url;
      const title = current.title;
      for (const origin of [base, 'https://editor.example']) {
        const previousId = current.id;
        const response = await post({ audio_url: `${origin}${audioPath}?cache=1`, duration_seconds: 0.1 },
          origin === base ? {} : { Origin: origin });
        assert.equal(response.status, 201);
        current = await response.json();
        assert.notEqual(current.id, previousId);
        assert.equal(current.audio_url, audioPath);
        assert.equal(current.title, title);
        assert.deepEqual(current.lines, []);
        assert.equal(current.alignment, null);
        const audio = await fetch(base + audioPath);
        assert.equal(audio.status, 200);
        assert.deepEqual(Buffer.from(await audio.arrayBuffer()), wav);
        assert.equal((await readdir(uploads)).length, 1);
      }
      await stop(); await start();
      assert.deepEqual(await (await get()).json(), current);
      const audio = await fetch(base + audioPath);
      assert.equal(audio.status, 200);
      await audio.arrayBuffer();
    });
    await t.test('a remote URL with the same path stays remote and does not retain the previous upload', async () => {
      const oldAudio = current.audio_url;
      const remote = `https://remote.example${oldAudio}`;
      const response = await post({ audio_url: remote, duration_seconds: 0.1 });
      assert.equal(response.status, 201);
      assert.equal((await response.json()).audio_url, remote);
      assert.equal((await fetch(base + oldAudio)).status, 404);
      assert.equal((await readdir(uploads)).length, 0);
      // Restore an uploaded source for the remaining failure-path checks.
      const restored = await upload();
      assert.equal(restored.status, 201);
      current = await restored.json();
    });
    await t.test('unsupported, invalid, and malformed uploads are removed without replacing audio', async () => {
      for (const options of [{ filename: 'bad.txt' }, { data: Buffer.from('not audio') }, { duration: 'NaN' }, { duration: '' }, { title: 'x'.repeat(1025) }]) {
        assert.equal((await upload(options)).status, 400);
        assert.deepEqual(await (await get()).json(), current);
        assert.equal((await readdir(uploads)).length, 1);
      }
      const missing = new FormData(); missing.append('duration_seconds', '1');
      assert.equal((await fetch(`${base}/api/v1/track`, { method: 'POST', headers, body: missing })).status, 400);
      const malformed = await fetch(`${base}/api/v1/track`, { method: 'POST', headers: { ...headers, 'Content-Type': 'multipart/form-data; boundary=broken' }, body: '--broken\r\n' });
      assert.equal(malformed.status, 400);
      const partial = await fetch(`${base}/api/v1/track`, { method: 'POST', headers: { ...headers, 'Content-Type': 'multipart/form-data; boundary=broken' }, body: Buffer.concat([
        Buffer.from('--broken\r\nContent-Disposition: form-data; name="file"; filename="partial.wav"\r\nContent-Type: audio/wav\r\n\r\n'), wav,
      ]) });
      assert.equal(partial.status, 400);
      assert.equal((await readdir(uploads)).length, 1);
    });
    await t.test('oversized streaming uploads receive 413 and leave no partial file', async () => {
      const boundary = 'large-audio-test';
      const response = await new Promise((resolve, reject) => {
        const req = request(`${base}/api/v1/track`, { method: 'POST', headers: { ...headers, 'Content-Type': `multipart/form-data; boundary=${boundary}` } }, (res) => {
          res.resume(); res.on('end', () => resolve(res.statusCode));
        });
        req.on('error', reject);
        void (async () => {
          req.write(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="large.wav"\r\nContent-Type: audio/wav\r\n\r\n`);
          const chunk = Buffer.alloc(1024 * 1024);
          for (let i = 0; i < 101; i++) {
            if (req.destroyed) return;
            if (!req.write(chunk)) await once(req, 'drain');
          }
          req.end(`\r\n--${boundary}--\r\n`);
        })().catch(reject);
      });
      assert.equal(response, 413);
      assert.equal((await readdir(uploads)).length, 1);
      assert.deepEqual(await (await get()).json(), current);
    });
    await t.test('interrupted upload cleans up its staged file', async () => {
      const req = request(`${base}/api/v1/track`, { method: 'POST', headers: { ...headers, 'Content-Type': 'multipart/form-data; boundary=interrupt' } });
      req.on('error', () => {});
      req.write('--interrupt\r\nContent-Disposition: form-data; name="file"; filename="partial.wav"\r\nContent-Type: audio/wav\r\n\r\n');
      req.write(wav);
      await eventually(async () => (await readdir(uploads)).length === 2);
      req.destroy();
      await eventually(async () => (await readdir(uploads)).length === 1);
      assert.deepEqual(await (await get()).json(), current);
    });
    await t.test('database failure rolls back replacement and deletes staged upload', async () => {
      const db = new DatabaseSync(dbPath);
      db.exec("CREATE TRIGGER reject_replacement BEFORE INSERT ON tracks BEGIN SELECT RAISE(ABORT, 'test storage failure'); END");
      try {
        const failed = await upload();
        assert.equal(failed.status, 500);
        assert.equal((await failed.json()).error, 'track_storage_failed');
        assert.deepEqual(await (await get()).json(), current);
        assert.equal((await readdir(uploads)).length, 1);
      } finally { db.exec('DROP TRIGGER reject_replacement'); db.close(); }
    });
    await t.test('unwritable storage returns actionable error and retains current track', async () => {
      await stop();
      const blocked = join(directory, 'not-a-directory');
      await writeFile(blocked, 'blocked');
      await start({ UPLOAD_DIR: blocked });
      const response = await upload();
      assert.equal(response.status, 500);
      assert.equal((await response.json()).error, 'track_storage_failed');
      assert.deepEqual(await (await get()).json(), current);
      await stop(); await start();
    });
    await t.test('successful replacement deletes only the previous uploaded audio', async () => {
      const oldAudio = current.audio_url;
      assert.equal((await post({ ...urlBody, title: 'Replacement' })).status, 201);
      assert.equal((await fetch(base + oldAudio)).status, 404);
      assert.equal((await readdir(uploads)).length, 0);
      const bundled = await fetch(`${base}/api/audio/you-verse-you.mp3`);
      assert.equal(bundled.status, 200);
      await bundled.arrayBuffer();
      const fallback = await post({ audio_url: 'https://example.com/', duration_seconds: 2 });
      assert.equal((await fallback.json()).title, 'Untitled song');
    });
  } finally {
    await stop();
    await rm(directory, { recursive: true, force: true });
  }
});
