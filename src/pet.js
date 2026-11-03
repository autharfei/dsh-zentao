export class PetClient {
  constructor({ origin, petId = () => '', fetchImpl = globalThis.fetch }) { this.origin = origin; this.petId = petId; this.fetchImpl = fetchImpl; this.abort = new AbortController(); }
  async request(path, options = {}) {
    const origin = typeof this.origin === 'function' ? this.origin() : this.origin;
    if (!origin || !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) throw new Error('DSH 桌宠服务尚未就绪');
    let response;
    try { response = await this.fetchImpl(`${origin}/dsh-pet-7340/${path}`, { ...options, redirect: 'error', signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(5000)]) }); }
    catch { throw new Error('无法连接桌宠服务，请检查 dsh-pet 是否启用'); }
    if (!response.ok) throw new Error(`桌宠接口不可用（HTTP ${response.status}），请检查插件状态与访问权限`);
    try { return await response.json(); } catch { throw new Error('桌宠接口返回格式无效'); }
  }
  async list() {
    const config = await this.request('config'); const pets = []; const seen = new Set();
    for (const entry of Object.values(config)) if (entry && typeof entry === 'object' && Array.isArray(entry.pets)) {
      for (const pet of entry.pets) if (pet && typeof pet.id === 'string' && !seen.has(pet.id)) { seen.add(pet.id); pets.push({ id: pet.id, name: String(pet.name || pet.id), display: String(pet.display || 'none') }); }
    }
    return { available: true, pets };
  }
  async send(text) {
    const { pets } = await this.list(); const requested = typeof this.petId === 'function' ? this.petId() : this.petId;
    const pet = requested ? pets.find(pet => pet.id === requested) : pets.find(pet => ['desktop', 'both'].includes(pet.display));
    if (!pet || !['desktop', 'both'].includes(pet.display)) throw new Error('未找到可用的桌面宠物，请在 dsh-pet 中启用桌面显示');
    const query = new URLSearchParams({ pet: pet.id, surface: 'desktop' });
    const result = await this.request(`broadcast?${query}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, duration: 10000, anim: false }) });
    if (result.ok !== true) throw new Error(result.reason === 'lock-required' || result.reason === 'lock-lost' ? '桌宠正被其他联动占用，稍后重试' : `桌宠未受理提醒（${String(result.reason || 'unknown')}）`);
    return { accepted: true };
  }
  stop() { this.abort.abort(); }
}
