import { readConnection, loadConfiguredConnection, locations } from '../src/config.js';
import { ZentaoClient } from '../src/zentao.js';

const configured = process.env.ZENTAO_CONNECTION_FILE ? await readConnection(process.env.ZENTAO_CONNECTION_FILE) : (await loadConfiguredConnection(locations())).connection;
if (!configured) throw new Error('尚未配置禅道连接，请先在插件设置中填写并保存');
const client = new ZentaoClient(configured);
try {
  const started = Date.now(); const snapshot = await client.snapshot();
  const mine = rows => rows.filter(item => item.assignedTo.account === snapshot.account).length;
  console.log(JSON.stringify({ ok: true, tasks: snapshot.tasks.length, myTasks: mine(snapshot.tasks), bugs: snapshot.bugs.length, myBugs: mine(snapshot.bugs), elapsedMs: Date.now() - started }));
  for (const [kind, rows] of [['task', snapshot.tasks], ['bug', snapshot.bugs]]) if (rows.length) {
    const detail = await client.detail(kind, rows[0].id);
    console.log(JSON.stringify({ detail: kind, ok: Boolean(detail.id), actions: detail.actions.length, files: detail.files.length, descriptionLength: detail.html.length }));
    if (process.argv.includes('--images')) {
      const match = detail.html.match(/(?:file-read-|fileID[=\"']+|fileID%3D)(\d+)/i);
      if (match) { try { const image = await client.image(match[1]); console.log(JSON.stringify({ image: true, ok: true, type: image.type, bytes: image.body.length })); } catch (error) { console.log(JSON.stringify({ image: true, ok: false, error: error.message })); } }
    }
  }
} finally { client.stop(); }
