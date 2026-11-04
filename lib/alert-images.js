import { readFile, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

export const MAX_ALERT_IMAGE_BYTES = 2 * 1024 * 1024;
const validId = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function rasterType(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('ascii'))) return 'image/gif';
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  throw new Error('气泡图片仅支持 PNG、JPEG、GIF 或 WebP');
}
export class AlertImageStore {
  constructor(directory) { this.directory = directory; this.stopped = false; this.server = null; this.starting = null; this.capability = randomBytes(24).toString('hex'); }
  async ensureServer() {
    if (this.stopped) throw new Error('插件已卸载');
    if (this.starting) return this.starting;
    // Desktop pets have no DSH browser cookie. Expose only raster bytes through
    // an ephemeral loopback capability URL, never a session token or file path.
    const server = createServer(async (req, res) => {
      const finish = status => { res.writeHead(status, { 'Cache-Control': 'no-store' }); res.end(); };
      const host = `127.0.0.1:${server.address()?.port}`;
      if (req.headers.host !== host || !['GET', 'HEAD'].includes(req.method)) return finish(404);
      const match = (req.url || '').match(new RegExp(`^/${this.capability}/([a-f0-9]{64})$`));
      if (!match) return finish(404);
      try {
        const { body, type } = await this.read(match[1]);
        res.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" });
        res.end(req.method === 'HEAD' ? undefined : body);
      } catch { finish(404); }
    });
    this.server = server;
    this.starting = new Promise((resolve, reject) => {
      server.once('error', () => { this.starting = null; reject(new Error('无法启动本机气泡图片服务')); });
      server.listen(0, '127.0.0.1', () => { if (this.stopped) { server.close(); reject(new Error('插件已卸载')); } else { server.unref(); resolve(server.address().port); } });
    });
    return this.starting;
  }
  async save(data) {
    if (this.stopped) throw new Error('插件已卸载');
    if (typeof data !== 'string' || !data || data.length > Math.ceil(MAX_ALERT_IMAGE_BYTES / 3) * 4 || data.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new Error('图片格式无效或超过 2 MiB');
    const body = Buffer.from(data, 'base64');
    if (!body.length || body.length > MAX_ALERT_IMAGE_BYTES || body.toString('base64') !== data) throw new Error('图片格式无效或超过 2 MiB');
    const type = rasterType(body); const id = createHash('sha256').update(body).digest('hex');
    const temporary = join(this.directory, `${id}.${randomUUID()}.tmp`);
    try {
      await mkdir(this.directory, { recursive: true });
      if (this.stopped) throw new Error('插件已卸载');
      await writeFile(temporary, body, { mode: 0o600 });
      if (this.stopped) throw new Error('插件已卸载');
      await rename(temporary, join(this.directory, id));
    } catch { throw new Error(this.stopped ? '插件已卸载' : '无法保存气泡图片，请检查本地存储目录权限'); }
    finally { await unlink(temporary).catch(() => {}); }
    return { id, type, bytes: body.length, url: `/api/zentao/pet-image?id=${id}` };
  }
  async read(id) {
    if (!validId(id)) throw new Error('气泡图片编号无效');
    let body; try { body = await readFile(join(this.directory, id)); } catch { throw new Error('气泡图片不存在，请重新上传'); }
    if (!body.length || body.length > MAX_ALERT_IMAGE_BYTES) throw new Error('气泡图片无效');
    return { body, type: rasterType(body) };
  }
  async url(id) {
    await this.read(id); const port = await this.ensureServer();
    return `http://127.0.0.1:${port}/${this.capability}/${id}`;
  }
  stop() { this.stopped = true; this.server?.closeAllConnections(); this.server?.close(); }
}
