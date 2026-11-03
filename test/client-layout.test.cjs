'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

// Opt-in integration test: use the installed host's real React and exact frame CSS.
// The browser owns a fresh temporary profile and about:blank; no DSH/profile/token/server access.
const asar = process.env.DSH_ZENTAO_HOST_ASAR || '';
const browserPath = process.env.DSH_ZENTAO_BROWSER || (process.env.DSH_ZENTAO_BROWSER_TEST === '1' ? [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(file => fs.existsSync(file)) : null);
const available = Boolean(browserPath && asar && fs.existsSync(asar));
const skinClient = process.env.DSH_ZENTAO_SKIN_CLIENT || '';
const skinCss = skinClient && fs.existsSync(skinClient) ? fs.readFileSync(skinClient, 'utf8').match(/var skin_default = `([\s\S]*?)`;/)?.[1] : null;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser, temporaryProfile, socket, nextId = 0;
const pending = new Map();
function readPacked(relative) {
  const fd = fs.openSync(asar, 'r');
  try {
    const preamble = Buffer.alloc(16); fs.readSync(fd, preamble, 0, 16, 0);
    const headerBuffer = Buffer.alloc(preamble.readUInt32LE(12)); fs.readSync(fd, headerBuffer, 0, headerBuffer.length, 16);
    let entry = JSON.parse(headerBuffer);
    for (const segment of relative.split('/')) entry = entry.files[segment];
    const bytes = Buffer.alloc(entry.size); fs.readSync(fd, bytes, 0, bytes.length, 8 + preamble.readUInt32LE(4) + Number(entry.offset));
    return bytes.toString('utf8');
  } finally { fs.closeSync(fd); }
}
function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timed out: ${method}`)); }, 15000);
    pending.set(id, { resolve(value) { clearTimeout(timeout); resolve(value); }, reject(error) { clearTimeout(timeout); reject(error); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(`${result.exceptionDetails.text}: ${result.exceptionDetails.exception?.description || ''}`);
  return result.result.value;
}
const packedBase = 'dsh/node_modules/@deepseek-ai/';
function cssLiteral(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`(?:const|var) ${escaped} = ("(?:\\\\.|[^"\\\\])*");`));
  assert.ok(match, `host CSS ${name} should exist`);
  return JSON.parse(match[1]);
}

test.before(async () => {
  if (!available) return;
  temporaryProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-zentao-layout-'));
  browser = spawn(browserPath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-sync', '--remote-debugging-port=0', `--user-data-dir=${temporaryProfile}`, 'about:blank'], { stdio: 'ignore' });
  const portFile = path.join(temporaryProfile, 'DevToolsActivePort'); let port;
  for (let i = 0; i < 120; i++) {
    if (fs.existsSync(portFile)) { port = fs.readFileSync(portFile, 'utf8').split('\n')[0]; break; }
    if (browser.exitCode !== null) throw new Error(`Chromium exited ${browser.exitCode}`);
    await delay(50);
  }
  assert.ok(port, 'Chromium CDP should start');
  const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl); await once(socket, 'open');
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data); const callback = pending.get(message.id);
    if (!callback) return; pending.delete(message.id);
    if (message.error) callback.reject(new Error(message.error.message)); else callback.resolve(message.result);
  });
  await cdp('Page.enable');
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  const vendor = readPacked(`${packedBase}dsh-web-frontend/dist/assets/vendor-DcuzkuQH.js`);
  const frontend = readPacked(`${packedBase}dsh-web-frontend/dist/assets/index-BXV-oxvX.js`);
  const boundary = frontend.indexOf('const Ls=globalThis.dshDesktopBoot');
  assert.ok(boundary > 0, 'test must stop before the host application bootstrap');
  // Import only the installed framework libraries; never run the DSH application bootstrap.
  await evaluate(`(async () => {
    document.open(); document.write('<!doctype html><html><head></head><body></body></html>'); document.close();
    const vendorUrl = URL.createObjectURL(new Blob([${JSON.stringify(vendor)}], {type:'text/javascript'}));
    const code = ${JSON.stringify(frontend.slice(0, boundary))}.replaceAll('"./vendor-DcuzkuQH.js"', JSON.stringify(vendorUrl)) + '\\nwindow.__hostModules = OZ();';
    const sourceUrl = URL.createObjectURL(new Blob([code], {type:'text/javascript'}));
    await import(sourceUrl); URL.revokeObjectURL(sourceUrl); URL.revokeObjectURL(vendorUrl);
    return typeof __hostModules['react-dom/client'].createRoot;
  })()`);
  const layout = readPacked(`${packedBase}dsh-client-ui-layout/lib/client.js`);
  const theme = readPacked(`${packedBase}dsh-client-ui-theme/lib/client.js`);
  const hostCss = cssLiteral(layout, 'css') + cssLiteral(theme, 'base_css_default') + cssLiteral(theme, 'design_platform_css_default');
  const client = fs.readFileSync(path.join(__dirname, '../src/client.cjs'), 'utf8');
  const model = fs.readFileSync(path.join(__dirname, '../src/client-model.cjs'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '../src/client.css'), 'utf8');
  await evaluate(`(() => {
    const style = document.createElement('style'); style.textContent = ${JSON.stringify(hostCss + '\nhtml,body{height:100%;margin:0}body{overflow:hidden}')} + ${JSON.stringify(styles)}; document.head.append(style);
    const skin = document.createElement('style'); skin.textContent = ${JSON.stringify(skinCss || '')}; document.head.append(skin);
    const modelModule = {exports:{}}; new Function('module', ${JSON.stringify(model)})(modelModule);
    const clientModule = {exports:{}};
    new Function('require','module','STYLES', ${JSON.stringify(client)})(id => id === 'react' ? __hostModules.react : modelModule.exports, clientModule, ${JSON.stringify(styles)});
    window.ZentaoClient = clientModule.exports;
    window.renderFixture = (dark = false) => {
      window.__root?.unmount();
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
      document.documentElement.setAttribute('data-windows-titlebar','');
      document.documentElement.style.setProperty('--dsh-windows-titlebar-height','36px');
      document.body.toggleAttribute('data-ds-dark-theme',dark);
      document.body.removeAttribute('data-liang-skin');
      document.body.removeAttribute('data-liang-stage');
      document.body.style.setProperty('--dsw-alias-label-primary','#f8faff');
      document.body.style.setProperty('--dsw-alias-label-secondary','#f1f4fb');
      document.body.innerHTML = '<div id="root" style="height:100%"><div class="mP3x-q_frame" style="grid-template-columns:280px minmax(0,1fr) 0px"><aside class="mP3x-q_sidebarCol"></aside><div class="mP3x-q_centerCol"><div data-slot="main" style="display:contents"></div></div><div class="mP3x-q_rightbarCol"></div><div class="mP3x-q_bottomRow"></div></div></div>';
      const data = {tasks:[{id:1,title:'Readable task title',status:'doing',pri:1,assignedTo:{account:'alice'}}],bugs:[],notifications:[],status:{lastSuccessAt:'2026-11-02T10:00:00Z'},settings:{pollSeconds:45},account:'alice',baseUrl:'https://zt.example/',connection:{baseUrl:'https://zt.example/',account:'alice',hasPassword:true}};
      window.__fixture = {data};
      const store = {getSnapshot: () => ({data:__fixture.data}),subscribe: listener => {window.__notify=listener;return () => {}},saveConnection: async body => ({connection:{baseUrl:body.baseUrl,account:body.account,hasPassword:true}})};
      window.__detailBehavior = null;
      const api = {detail:(kind,id,options) => window.__detailBehavior ? __detailBehavior(kind,id,options) : Promise.resolve({id:1,title:'Readable detail title',status:'doing',pri:1,html:'description',fields:{},actions:[],files:[]}),pets:async () => ({available:false,pets:[]})};
      __root = __hostModules['react-dom/client'].createRoot(document.querySelector('[data-slot="main"]'));
      __hostModules['react-dom'].flushSync(() => __root.render(__hostModules.react.createElement(ZentaoClient.ZentaoApp,{store,api})));
    };
    return true;
  })()`);
});

test.after(async () => {
  if (socket) socket.close();
  if (browser && browser.exitCode === null) { browser.kill(); await Promise.race([once(browser, 'exit'), delay(1000)]); }
  if (temporaryProfile && path.dirname(temporaryProfile) === os.tmpdir() && path.basename(temporaryProfile).startsWith('dsh-zentao-layout-')) {
    try { fs.rmSync(temporaryProfile, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); } catch { /* Chromium can retain its own temporary lock briefly. */ }
  }
});

test('真实Chromium中main铺满侧栏右侧可用高度，短窗口也不覆盖必要顶栏', {skip:!available}, async () => {
  for (const height of [800, 420]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width:1280,height,deviceScaleFactor:1,mobile:false });
    const geometry = await evaluate(`(() => {renderFixture();const app=document.querySelector('.zt-app').getBoundingClientRect();const center=document.querySelector('.mP3x-q_centerCol').getBoundingClientRect();return {app:{x:app.x,y:app.y,width:app.width,height:app.height,bottom:app.bottom},center:{x:center.x,y:center.y,width:center.width,height:center.height,bottom:center.bottom}};})()`);
    assert.ok(Math.abs(geometry.app.x - 280) <= 1, JSON.stringify(geometry));
    assert.ok(Math.abs(geometry.app.y - 36) <= 1, JSON.stringify(geometry));
    assert.ok(Math.abs(geometry.app.width - geometry.center.width) <= 1, JSON.stringify(geometry));
    assert.ok(Math.abs(geometry.app.bottom - height) <= 1, JSON.stringify(geometry));
    assert.ok(Math.abs(geometry.app.height - geometry.center.height) <= 1, JSON.stringify(geometry));
  }
});

test('真实皮肤z-index0背景不能盖住display-contents main内的页头和统计', {skip:!available || !skinCss}, async t => {
  await cdp('Emulation.setDeviceMetricsOverride', {width:1280,height:800,deviceScaleFactor:1,mobile:false});
  for (const dark of [false,true]) {
    const geometry=await evaluate(`(() => {
      renderFixture(${dark});
      document.body.dataset.liangSkin='on';document.body.dataset.liangStage='5';
      document.body.style.setProperty('--liang-page','#10131a');
      const stage=document.createElement('div');stage.className='liang-skin-backdrop';
      document.querySelector('.mP3x-q_centerCol').prepend(stage);
      const app=document.querySelector('.zt-app'),header=document.querySelector('.zt-header'),stats=document.querySelector('.zt-stat');
      const a=app.getBoundingClientRect(),h=header.getBoundingClientRect(),s=stats.getBoundingClientRect();
      return {app:{x:a.x,y:a.y,width:a.width,height:a.height},header:{x:h.x,y:h.y,width:h.width,height:h.height},stats:{x:s.x,y:s.y,width:s.width,height:s.height},pointerEvents:getComputedStyle(stage).pointerEvents,samples:[{name:'canvas',x:a.x+24,y:a.y+4},{name:'header',x:h.x+h.width/2,y:h.y+h.height/2},{name:'stats',x:s.x+20,y:s.y+8}]};
    })()`);
    assert.equal(geometry.pointerEvents,'none');
    assert.ok(geometry.header.height>0 && geometry.stats.height>0,'normal DOM geometry is insufficient to prove painting');
    const screenshot=await cdp('Page.captureScreenshot',{format:'png',fromSurface:true});
    const pixels=await evaluate(`(async () => {
      const image=new Image();image.src='data:image/png;base64,'+${JSON.stringify(screenshot.data)};await image.decode();
      const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const context=canvas.getContext('2d');context.drawImage(image,0,0);
      return ${JSON.stringify(geometry.samples)}.map(point=>({...point,rgba:[...context.getImageData(Math.round(point.x),Math.round(point.y),1,1).data]}));
    })()`);
    if(process.env.DSH_ZENTAO_PAINT_EVIDENCE_DIR && fs.existsSync(process.env.DSH_ZENTAO_PAINT_EVIDENCE_DIR)) fs.writeFileSync(path.join(process.env.DSH_ZENTAO_PAINT_EVIDENCE_DIR,`zentao-skin-paint-${dark?'dark':'light'}.png`),Buffer.from(screenshot.data,'base64'));
    t.diagnostic(JSON.stringify({dark,geometry,pixels}));
    const expected=dark?[19,24,33,255]:[247,248,252,255];
    for(const pixel of pixels.filter(point=>point.name!=='stats')) assert.deepEqual(pixel.rgba,expected,`${pixel.name} must paint above the skin backdrop`);
    assert.deepEqual(pixels.find(point=>point.name==='stats').rgba,dark?[27,34,48,255]:[255,255,255,255],'stat surface must remain visible above the backdrop');
  }
});

async function contrasts(selectors) {
  return evaluate(`(() => {
    const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');
    const rgba=value=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=value;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data];};
    const effective=el=>{const chain=[];for(let node=el;node;node=node.parentElement)chain.unshift(node);let rgb=[255,255,255];for(const node of chain){const c=rgba(getComputedStyle(node).backgroundColor),alpha=c[3]/255;rgb=rgb.map((v,i)=>c[i]*alpha+v*(1-alpha));}return rgb;};
    const luminance=rgb=>rgb.slice(0,3).map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4}).reduce((s,n,i)=>s+n*[.2126,.7152,.0722][i],0);
    return ${JSON.stringify(selectors)}.map(value=>{
      const [selector,pseudo]=Array.isArray(value)?value:[value,undefined];const el=document.querySelector(selector);if(!el)return {selector,missing:true};
      const foreground=getComputedStyle(el,pseudo).color,background=effective(el),a=luminance(rgba(foreground)),b=luminance(background);
      return {selector,pseudo,foreground,background,contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),theme:el.closest('.zt-app').dataset.theme};
    });
  })()`);
}
function assertContrasts(readings, dark) {
  for (const row of readings) { assert.equal(row.missing, undefined, row.selector); assert.ok(row.contrast>=4.5,JSON.stringify(row)); assert.equal(row.theme,dark?'dark':'light'); }
}

test('真实Chromium对浅白宿主变量保持标题、通知、设置与输入框对比至少4.5', {skip:!available}, async t => {
  await cdp('Emulation.setDeviceMetricsOverride', {width:1280,height:800,deviceScaleFactor:1,mobile:false});
  for (const dark of [false,true]) {
    await evaluate(`renderFixture(${dark})`);
    await evaluate(`document.querySelector('.zt-item-link').click()`); await delay(40);
    let readings=await contrasts(['.zt-title-line h1','.zt-item-link','.zt-detail-heading h2','.zt-stat-label','.zt-footer','.zt-status-doing',['.zt-search input','::placeholder']]);
    assertContrasts(readings,dark);
    await evaluate(`(() => {__fixture.data={...__fixture.data,notifications:[{id:'n1',kind:'task',itemId:1,title:'Readable notice',read:false,reason:'assigned'}]};__notify();[...document.querySelectorAll('.zt-tabs button')].find(el=>el.textContent.includes('通知')).click();})()`); await delay(30);
    const notices=await contrasts(['.zt-notice-title','.zt-notice-delivery','.zt-notice-reason']); assertContrasts(notices,dark);readings.push(...notices);
    await evaluate(`document.querySelector('[aria-label="同步与提醒设置"]').click()`);await delay(30);
    const primarySelectors=['.zt-connection-form .zt-button-primary','.zt-sync-form .zt-button-primary'];
    const settings=await contrasts(['.zt-connection-form > label','.zt-connection-form input','.zt-connection-help','.zt-setting-row p',['.zt-connection-form input[name="password"]','::placeholder'],...primarySelectors]);assertContrasts(settings,dark);readings.push(...settings);
    for (const selector of primarySelectors) {
      const position=await evaluate(`(() => {const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:'center'});const rect=el.getBoundingClientRect();return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};})()`);
      await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',...position});await delay(10);
      assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)}).matches(':hover')`),true,selector);
      const hover=await contrasts([selector]);assertContrasts(hover,dark);readings.push(...hover.map(row=>({...row,state:'hover'})));
    }
    t.diagnostic(JSON.stringify({dark,minContrast:Math.min(...readings.map(row=>row.contrast)),readings}));
  }
});

test('真实React切账号立即卸载旧详情并中止旧请求，迟到响应不能污染新账号', {skip:!available}, async () => {
  await evaluate(`(() => {renderFixture();window.__detailBehavior=(kind,id,{signal})=>{window.__oldSignal=signal;return new Promise(resolve=>{window.__oldResolve=resolve;});};document.querySelector('.zt-item-link').click();})()`); await delay(30);
  await evaluate(`(() => {__fixture.data={...__fixture.data,account:'bob',baseUrl:'https://other.example/',connection:{baseUrl:'https://other.example/',account:'bob',hasPassword:true},tasks:[{id:1,title:'Bob task',status:'doing',assignedTo:{account:'bob'}}]};__notify();})()`);await delay(30);
  const switched=await evaluate(`({aborted:__oldSignal.aborted,details:document.querySelectorAll('.zt-detail').length,title:document.querySelector('.zt-item-link').textContent})`);
  assert.equal(switched.aborted,true);assert.equal(switched.details,0);assert.equal(switched.title,'Bob task');
  await evaluate(`__oldResolve({id:1,title:'OLD PRIVATE DETAIL',html:'old description',fields:{},actions:[],files:[]})`);await delay(20);
  assert.equal(await evaluate(`document.querySelector('.zt-app').textContent.includes('OLD PRIVATE DETAIL')`),false);
  await evaluate(`(() => {window.__detailBehavior=null;document.querySelector('.zt-item-link').click();})()`);await delay(30);
  assert.equal(await evaluate(`document.querySelector('.zt-detail-heading h2').textContent`),'Readable detail title');
});
