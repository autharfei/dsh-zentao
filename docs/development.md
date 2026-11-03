# 开发说明

项目使用 Node.js 原生 ESM 作为 Host，客户端使用 DSH 共享的 React 与 ModuleLoader。运行时没有新增第三方依赖。

## 目录

- `src/`：Host 生命周期、连接、同步、状态存储、HTTP、桌宠适配及客户端。
- `scripts/build.mjs`：从源码生成 `lib/`，把客户端与样式包装为宿主模块。
- `scripts/pack.mjs`：构建并按固定白名单生成安装包，输出 SHA-256。
- `scripts/verify-live.mjs`：可选的人工联网检查入口，使用操作者本机已保存的连接。
- `test/`：合成数据的单元检查及按需启用的 Chromium 集成检查。

`lib/`、`dist/`、本地配置与测试输出不进入 Git。发布安装包前运行 `node scripts/pack.mjs`；不要复制本机 DSH 数据目录到仓库。

## 单元检查

需由操作者自行执行：

```sh
node --test --test-isolation=none
```

`--test-isolation=none` 用于避免受限 Windows 环境对子进程 stdio 管道的限制。构建相关用例会生成被忽略的 `lib/` 和 `dist/`。

## 可选 Chromium 检查

客户端富文本检查使用新建的临时浏览器配置；布局检查只读取本机安装包中的框架库和布局 CSS，不启动 DSH 应用，也不使用 DSH 登录态。

PowerShell 示例（路径请替换为自己的环境）：

```powershell
$env:DSH_ZENTAO_BROWSER_TEST = '1'
$env:DSH_ZENTAO_BROWSER = '<Chrome 或 Edge 可执行文件绝对路径>'
$env:DSH_ZENTAO_HOST_ASAR = '<DeepSeek Harness resources/app.asar 绝对路径>'
# 可选：同时启用皮肤背景绘制检查
$env:DSH_ZENTAO_SKIN_CLIENT = '<liang 皮肤 lib/client.js 绝对路径>'
node --test --test-isolation=none
```

未提供宿主 ASAR 时，依赖宿主的布局检查跳过；未提供皮肤源码时，皮肤绘制检查跳过。布局用例对应 DSH `0.2.1-rc.5` 的资源结构，其他宿主版本的资源名称或内部 CSS 可能不同，需要调整用例适配。

若需要保存绘制截图，设置 `DSH_ZENTAO_PAINT_EVIDENCE_DIR` 为自行创建的本地目录。截图可能带有个人信息，不应提交到公开仓库。

## 0.1.5 桌宠联动

新增 `src/alert-images.js` 只管理上传位图；由插件存储目录保存，桌面读取使用仅绑定127.0.0.1的随机端口及启动随机访问标识。浏览器预览继续走DSH同源路由，图片原始内容不会写入Git或安装包。

通知投递与快照扫描分开，按任务/Bug合并，等待上一条实际配置的显示时长后再发送下一条。卸载或切连接时中止队列；已受理项持久标记delivered，未受理项保留到后续扫描重试。动作和配图失效时可降级文字，并显示warning。

本轮已更新受新增默认字段和异步投递影响的既有测试定义，但未执行任何测试。安装验收应由操作者分别检查：旧配置升级、两种独立配置、图片上传/替换、关闭设置页后提醒、两类同时到达、图片/动作失效、桌宠未启用/睡眠/被占用、卸载后服务停止及重新启动配置恢复。

## 提交范围

测试应使用 `example`、`invalid`、`.test` 域及合成账号，不放真实站点、响应、任务标题、截图或密码。不要提交 `.env`、连接文件、通知状态、私钥、凭据、访问令牌或日志。

上传前检查 `git diff --cached` 与 `git status`。开源包只包含固定构建白名单，不包含测试、调试输出或用户存储。
