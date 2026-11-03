import { MAX_ALERT_IMAGE_BYTES } from './alert-images.js';
const PREFIX = '/api/zentao';
const loopback = address => typeof address === 'string' && (address === '::1' || /^127\.\d+\.\d+\.\d+$/.test(address) || /^::ffff:127\.\d+\.\d+\.\d+$/.test(address));
export function trustedRequest(req, { image = false } = {}) {
  if (!loopback(req.socket?.remoteAddress)) return false;
  const host = req.headers.host; if (typeof host !== 'string') return false;
  let served; try { served = new URL(`http://${host}`); } catch { return false; }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(served.hostname)) return false;
  const origin = req.headers.origin;
  if (image && req.headers['sec-fetch-dest'] === 'image') {
    // srcdoc without allow-same-origin has an opaque origin. Only raster image
    // responses may be embedded from that frame; no JSON or mutations use this path.
    const referer = req.headers.referer;
    if (referer) { try { if (new URL(referer).host !== served.host) return false; } catch { return false; } }
    return origin === undefined || origin === 'null' || origin === served.origin;
  }
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  if (origin === undefined) return true;
  try { return new URL(origin).host === served.host && ['http:', 'https:'].includes(new URL(origin).protocol); } catch { return false; }
}
function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }); res.end(JSON.stringify(data));
}
async function body(req, maximum = 65536) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new Error('请求必须使用 JSON');
  const chunks = []; let bytes = 0;
  for await (const chunk of req) { bytes += chunk.length; if (bytes > maximum) throw new Error('请求内容超过限制'); chunks.push(chunk); }
  let result; try { result = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw new Error('JSON 格式无效'); }
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('JSON 必须是对象');
  return result;
}
function numericId(value) { if (!/^\d+$/.test(value || '') || !Number.isSafeInteger(Number(value)) || Number(value) < 1) throw new Error('对象编号无效'); return value; }
export function createHandler({ service, getClient, pet, imageStore }) {
  return async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost'); const path = url.pathname.slice(PREFIX.length);
    if (!trustedRequest(req, { image: ['/image', '/pet-image'].includes(path) && req.method === 'GET' })) return json(res, 403, { ok: false, error: '仅允许本机 DSH 同源访问' });
    const allowed = { '/overview': ['GET'], '/refresh': ['POST'], '/detail': ['GET'], '/image': ['GET'], '/read': ['POST'], '/settings': ['GET', 'POST'], '/connection': ['GET', 'POST'], '/pets': ['GET'], '/pet-test': ['POST'], '/pet-image': ['GET', 'POST'] };
    if (!allowed[path]) return json(res, 404, { ok: false, error: '接口不存在' });
    if (!allowed[path].includes(req.method)) { res.setHeader('Allow', allowed[path].join(', ')); return json(res, 405, { ok: false, error: '请求方法不支持' }); }
    try {
      const input = req.method === 'POST' ? await body(req, path === '/pet-image' ? Math.ceil(MAX_ALERT_IMAGE_BYTES / 3) * 4 + 64 : 65536) : {};
      let data;
      switch (path) {
        case '/overview': data = service.overview(); break;
        case '/refresh': data = await service.refresh(); break;
        case '/detail': {
          const client = getClient(); if (!client) throw new Error('尚未配置禅道连接');
          const kind = url.searchParams.get('kind'); if (!['task', 'bug'].includes(kind)) throw new Error('对象类型无效');
          data = await client.detail(kind, numericId(url.searchParams.get('id'))); break;
        }
        case '/image': {
          const client = getClient(); if (!client) throw new Error('尚未配置禅道连接');
          const image = await client.image(numericId(url.searchParams.get('id')));
          res.writeHead(200, { 'Content-Type': image.type, 'Content-Length': image.body.length, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; sandbox" }); res.end(image.body); return;
        }
        case '/read': if (input.all === true) data = await service.markRead('all'); else { if (!Array.isArray(input.ids) || input.ids.length > 5000 || input.ids.some(id => typeof id !== 'string' || id.length > 100)) throw new Error('通知编号列表无效'); data = await service.markRead(input.ids); } break;
        case '/settings': data = req.method === 'GET' ? service.settings() : await service.updateSettings(input); break;
        case '/connection': data = req.method === 'GET' ? service.connection() : await service.saveConnection(input); break;
        case '/pets': try { data = await pet.list(); } catch (error) { data = { available: false, pets: [], error: error.message }; } break;
        case '/pet-image': {
          if (!imageStore) throw new Error('气泡图片存储尚未就绪');
          if (req.method === 'POST') {
            if (Object.keys(input).some(key => key !== 'data')) throw new Error('图片上传包含不允许的字段');
            data = await imageStore.save(input.data); break;
          }
          const image = await imageStore.read(url.searchParams.get('id'));
          res.writeHead(200, { 'Content-Type': image.type, 'Content-Length': image.body.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" }); res.end(image.body); return;
        }
        case '/pet-test': {
          const kind = input.kind ?? 'task';
          if (!['task', 'bug'].includes(kind) || Object.keys(input).some(key => key !== 'kind')) throw new Error('桌宠提醒类型无效');
          data = await pet.send(`禅道插件：${kind === 'task' ? '任务' : 'Bug'}桌宠提醒测试。新指派会以此动作和气泡提示。`, { kind }); break;
        }
      }
      json(res, 200, { ok: true, data });
    } catch (error) { if (!res.destroyed) json(res, path === '/refresh' || path === '/pet-test' ? 502 : 400, { ok: false, error: error.message || '请求失败，请稍后重试' }); }
  };
}
