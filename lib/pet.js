import { DEFAULT_SETTINGS, normalizePetAlerts } from './config.js';

const strings = value => Array.isArray(value) ? value.filter(item => typeof item === 'string' && item) : [];
function animationNames(raw = {}) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const names = [...strings(value.idle), ...strings(value.turn), ...strings(value.drag), ...strings(value.clicks)];
  for (const item of Array.isArray(value.moves?.actions) ? value.moves.actions : []) if (typeof item?.name === 'string') names.push(item.name);
  for (const category of Array.isArray(value.categories) ? value.categories : []) names.push(...strings(category?.actions));
  for (const slots of Object.values(value.events && typeof value.events === 'object' ? value.events : {})) {
    for (const slot of Array.isArray(slots) ? slots : []) names.push(...(typeof slot === 'string' ? [slot] : strings(slot)));
  }
  return [...new Set(names)].slice(0, 1000);
}
const isLock = error => ['lock-required', 'lock-lost', 'locked'].includes(error.reason);
function accepted(result) {
  if (result?.ok === true) return;
  const reason = String(result?.reason || 'unknown');
  const error = new Error(['lock-required', 'lock-lost', 'locked'].includes(reason) ? '桌宠正被其他联动占用，稍后重试' : `桌宠未受理提醒（${reason}）`);
  error.reason = reason; throw error;
}
export class PetClient {
  constructor({ origin, petId = () => '', settings = () => DEFAULT_SETTINGS, imageStore = null, authenticatedUrl = null, fetchImpl = globalThis.fetch }) {
    this.origin = origin; this.petId = petId; this.settings = settings; this.imageStore = imageStore; this.authenticatedUrl = authenticatedUrl; this.fetchImpl = fetchImpl; this.abort = new AbortController(); this.cookie = ''; this.authorizing = null;
  }
  async authorize() {
    if (this.authorizing) return this.authorizing;
    this.authorizing = (async () => {
      const origin = this.getOrigin(); const url = new URL(this.authenticatedUrl(origin));
      if (url.origin !== origin || url.pathname !== '/') throw new Error('桌宠宿主登录入口无效');
      // Bootstrap the host-issued session only in memory. Never expose this URL
      // or cookie in errors, plugin settings, logs, or client responses.
      const response = await this.fetchImpl(url.href, { redirect: 'manual', signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(5000)]) });
      const cookies = response.headers.getSetCookie?.() || [response.headers.get('set-cookie')].filter(Boolean);
      this.cookie = cookies.map(value => value.split(';')[0]).join('; '); await response.body?.cancel();
      if (!this.cookie) throw new Error('桌宠宿主登录未完成');
    })().catch(() => { throw new Error('无法取得桌宠宿主访问权限，请重新启用插件'); }).finally(() => { this.authorizing = null; });
    return this.authorizing;
  }
  getOrigin() {
    const origin = typeof this.origin === 'function' ? this.origin() : this.origin;
    if (!origin || !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) throw new Error('DSH 桌宠服务尚未就绪');
    return origin;
  }
  async request(path, options = {}) {
    const { signal, ...init } = options; signal?.throwIfAborted(); this.abort.signal.throwIfAborted(); const signals = [this.abort.signal, AbortSignal.timeout(5000)]; if (signal) signals.push(signal);
    let response;
    const send = () => this.fetchImpl(`${this.getOrigin()}/dsh-pet-7340/${path}`, { ...init, headers: { ...init.headers, ...(this.cookie ? { Cookie: this.cookie } : {}) }, redirect: 'error', signal: AbortSignal.any(signals) });
    try {
      response = await send();
      if (response.status === 401 && this.authenticatedUrl) { await response.body?.cancel(); await this.authorize(); response = await send(); }
    } catch { throw new Error('无法连接桌宠服务，请检查 dsh-pet 是否启用或重新启用禅道插件'); }
    if (!response.ok) throw new Error(`桌宠接口不可用（HTTP ${response.status}），请检查插件状态与访问权限`);
    try { return await response.json(); } catch { throw new Error('桌宠接口返回格式无效'); }
  }
  async list({ signal } = {}) {
    const config = await this.request('config', { signal }); const pets = []; const seen = new Set();
    for (const [assetRoot, entry] of Object.entries(config)) if (entry && typeof entry === 'object' && Array.isArray(entry.pets)) {
      const animations = animationNames(entry.animations);
      const images = Object.entries(entry.memes && typeof entry.memes === 'object' && !Array.isArray(entry.memes) ? entry.memes : {})
        .filter(([key, description]) => key && typeof description === 'string' && description.trim()).slice(0, 1000).map(([name, description]) => ({ name, description }));
      for (const pet of entry.pets) if (pet && typeof pet.id === 'string' && !seen.has(pet.id)) {
        seen.add(pet.id); pets.push({ id: pet.id, name: String(pet.name || pet.id), display: String(pet.display || 'none'), assetRoot, animations, images });
      }
    }
    return { available: true, pets };
  }
  async send(text, { kind = 'task', signal } = {}) {
    if (!['task', 'bug'].includes(kind)) throw new Error('桌宠提醒类型无效');
    const { pets } = await this.list({ signal }); const requested = typeof this.petId === 'function' ? this.petId() : this.petId;
    const pet = requested ? pets.find(item => item.id === requested) : pets.find(item => ['desktop', 'both'].includes(item.display));
    if (!pet || !['desktop', 'both'].includes(pet.display)) throw new Error('未找到可用的桌面宠物，请在 dsh-pet 中启用桌面显示');
    const settings = { ...DEFAULT_SETTINGS, ...(typeof this.settings === 'function' ? this.settings() : this.settings) };
    const profile = normalizePetAlerts(settings.petAlerts)[kind]; const warnings = [];
    const query = new URLSearchParams({ pet: pet.id, surface: 'desktop' });
    const post = (path, payload) => this.request(`${path}?${query}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal });
    if (profile.animation) {
      try { accepted(await post('anim', { name: profile.animation })); }
      catch (error) { if (isLock(error) || signal?.aborted || this.abort.signal.aborted) throw error; warnings.push('所选动作暂不可用，已保留气泡提醒'); }
    }
    const payload = { text, duration: settings.petDurationSeconds * 1000, anim: false };
    if (profile.imageType === 'meme') payload.image = profile.image;
    if (profile.imageType === 'url') payload.url = profile.image;
    if (profile.imageType === 'upload') {
      try { if (!this.imageStore) throw new Error('No image store'); payload.url = await this.imageStore.url(profile.image); }
      catch { warnings.push('上传图片暂不可用，请重新上传；本次已使用文字提醒'); }
    }
    try { accepted(await post('broadcast', payload)); }
    catch (error) {
      if (isLock(error) || !['unknown-image', 'bad-request'].includes(error.reason) || (!payload.image && !payload.url)) throw error;
      delete payload.image; delete payload.url;
      accepted(await post('broadcast', payload)); warnings.push('气泡配图不可用，本次已使用文字提醒');
    }
    return { accepted: true, durationSeconds: settings.petDurationSeconds, ...(warnings.length ? { warning: warnings.join('；') } : {}) };
  }
  stop() { this.abort.abort(); this.cookie = ''; }
}
