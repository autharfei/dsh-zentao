import { readFile, writeFile, mkdir, rename, unlink, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';

const emptyAlert = () => ({ animation: '', imageType: 'none', image: '' });
export const DEFAULT_SETTINGS = Object.freeze({ pollSeconds: 45, notificationsEnabled: true, petEnabled: true, petId: '', petDurationSeconds: 10, petAlerts: { task: emptyAlert(), bug: emptyAlert() } });
export function normalizePetAlerts(raw) {
  if (raw === undefined) return { task: emptyAlert(), bug: emptyAlert() };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(key => !['task', 'bug'].includes(key))) throw new Error('桌宠提醒配置格式无效');
  const result = {};
  for (const kind of ['task', 'bug']) {
    const profile = raw[kind] === undefined ? emptyAlert() : raw[kind];
    if (!profile || typeof profile !== 'object' || Array.isArray(profile) || Object.keys(profile).some(key => !['animation', 'imageType', 'image'].includes(key))) throw new Error('桌宠提醒包含不允许的字段');
    const { animation = '', imageType = 'none', image = '' } = profile;
    if (typeof animation !== 'string' || animation.length > 200 || /[\u0000-\u001f]/.test(animation) || !['none', 'meme', 'upload', 'url'].includes(imageType) || typeof image !== 'string' || image.length > 2048) throw new Error('桌宠动作或气泡图片格式无效');
    let value = image.trim();
    if (imageType === 'none') value = '';
    if (imageType === 'upload' && !/^[a-f0-9]{64}$/.test(value)) throw new Error('请先上传气泡图片');
    if (imageType === 'meme' && (!value || value.length > 200 || /[\\/\u0000-\u001f]/.test(value))) throw new Error('请选择有效的桌宠表情图片');
    if (imageType === 'url') {
      let url; try { url = new URL(value); } catch { throw new Error('请输入有效的气泡图片网址'); }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error('气泡图片只支持无嵌入账号密码的 HTTP/HTTPS 网址');
      value = url.href;
    }
    result[kind] = { animation: animation.trim(), imageType, image: value };
  }
  return result;
}
export function locations(raw = {}) {
  const home = resolve(raw.dshHome || process.env.DSH_HOME || join(homedir(), '.dsh'));
  const storageDir = resolve(raw.storageDir || join(home, 'storages', 'dsh-zentao'));
  return { home, storageDir, privateConnectionFile: join(storageDir, 'connection.json') };
}
export function validateConnection(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('禅道连接文件格式无效');
  let url;
  try { url = new URL(raw.ZENTAO_BASE_URL); } catch { throw new Error('禅道地址无效，请检查连接文件'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('禅道地址必须是无嵌入凭据的 HTTP/HTTPS 地址');
  if (typeof raw.ZENTAO_ACCOUNT !== 'string' || !raw.ZENTAO_ACCOUNT.trim() || typeof raw.ZENTAO_PASSWORD !== 'string' || !raw.ZENTAO_PASSWORD) throw new Error('禅道连接文件缺少账号或密码');
  return { baseUrl: url.href.replace(/\/+$/, ''), account: raw.ZENTAO_ACCOUNT.trim(), password: raw.ZENTAO_PASSWORD };
}
export async function readConnection(file) {
  let raw;
  try { raw = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { throw new Error(error.code === 'ENOENT' ? '尚未配置禅道连接，请在插件设置中填写网址、账号和密码' : '无法读取禅道连接文件，请检查文件格式和访问权限'); }
  return validateConnection(raw);
}
export async function loadConfiguredConnection(paths) {
  try { await stat(paths.privateConnectionFile); }
  catch (error) {
    if (error.code !== 'ENOENT') throw new Error('无法读取插件连接文件，请检查访问权限');
    // A fresh installation requires the user to enter their own connection.
    // Never discover or import credentials from another integration.
    return { connection: null, source: paths.privateConnectionFile };
  }
  return { connection: await readConnection(paths.privateConnectionFile), source: paths.privateConnectionFile };
}
export function connectionPatch(patch, current) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('连接信息必须是对象');
  for (const key of Object.keys(patch)) if (!['baseUrl', 'account', 'password'].includes(key)) throw new Error('连接信息包含不允许的字段');
  if (typeof patch.baseUrl !== 'string' || patch.baseUrl.length > 2048 || typeof patch.account !== 'string' || patch.account.length > 200 || ('password' in patch && (typeof patch.password !== 'string' || patch.password.length > 4096))) throw new Error('网址、账号或密码格式无效');
  const normalized = validateConnection({ ZENTAO_BASE_URL: patch.baseUrl.trim(), ZENTAO_ACCOUNT: patch.account, ZENTAO_PASSWORD: patch.password || 'retained' });
  if (!patch.password) {
    if (!current?.password || normalized.baseUrl !== current.baseUrl || normalized.account !== current.account) throw new Error('首次连接或更换网址、账号时，请输入密码');
    normalized.password = current.password;
  }
  return normalized;
}
export async function saveConnectionFile(file, connection, { shouldCommit = () => true } = {}) {
  if (!shouldCommit()) throw new Error('插件已卸载');
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await mkdir(dirname(file), { recursive: true });
    if (!shouldCommit()) throw new Error('插件已卸载');
    await writeFile(temporary, JSON.stringify({ ZENTAO_BASE_URL: connection.baseUrl, ZENTAO_ACCOUNT: connection.account, ZENTAO_PASSWORD: connection.password }, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    if (!shouldCommit()) throw new Error('插件已卸载');
    await rename(temporary, file);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw new Error(shouldCommit() ? '无法保存禅道连接，请检查本地配置目录权限' : '插件已卸载');
  }
}
export function validateSettings(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('设置必须是对象');
  const allowed = new Set(Object.keys(DEFAULT_SETTINGS));
  for (const key of Object.keys(patch)) if (!allowed.has(key)) throw new Error(`不允许修改设置字段：${key}`);
  if ('pollSeconds' in patch && (!Number.isInteger(patch.pollSeconds) || patch.pollSeconds < 30 || patch.pollSeconds > 60)) throw new Error('同步间隔必须是 30～60 秒的整数');
  for (const key of ['notificationsEnabled', 'petEnabled']) if (key in patch && typeof patch[key] !== 'boolean') throw new Error('通知开关必须是布尔值');
  if ('petId' in patch && (typeof patch.petId !== 'string' || patch.petId.length > 100 || /[\u0000-\u001f]/.test(patch.petId))) throw new Error('桌宠编号无效');
  if ('petDurationSeconds' in patch && (!Number.isInteger(patch.petDurationSeconds) || patch.petDurationSeconds < 5 || patch.petDurationSeconds > 120)) throw new Error('桌宠气泡显示时长须为 5～120 秒的整数');
  return { ...patch, ...('petAlerts' in patch ? { petAlerts: normalizePetAlerts(patch.petAlerts) } : {}) };
}
export function publicSettings(settings, connectionFile, hasCredentials) {
  return { ...Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map(key => [key, settings[key] ?? DEFAULT_SETTINGS[key]])), petAlerts: normalizePetAlerts(settings.petAlerts), connectionFile, hasCredentials: Boolean(hasCredentials) };
}
