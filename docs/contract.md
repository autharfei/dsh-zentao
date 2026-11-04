# Host/Client contract v1

所有接口均为同源 `/api/zentao` 前缀。JSON成功 `{ok:true,data:...}`，失败 `{ok:false,error:"中文可读消息"}`；HTTP错误码有效。Host不向浏览器返回密码/Token。

- `GET /overview` -> `{scopeKey,tasks:Item[],bugs:Item[],notifications:Notice[],status:Status,settings:Settings,account,baseUrl}`。
- `POST /refresh` body `{}` -> 同overview。仅同步，不修改禅道。
- `GET /detail?kind=task|bug&id=123` -> `{kind,id,title,status,pri,severity?,assignedTo:{account,realname},fields:{[label]:string},html:string,actions:[{id,date,actor,action,comment,history?}],files:[{id,title,url?}],url:string}`。html为原始描述HTML；前端必须使用sandbox iframe，文档强CSP禁止脚本/表单/导航，img只放行受控同源`/image?id=`。
- `GET /operation-context?kind=task|bug&id=123&scopeKey=<overview.scopeKey>` -> `{scopeKey,version,item:Detail,actions:OperationAction[],warnings:string[]}`。必须回传打开列表时的overview.scopeKey，Host在读取前检查连接归属，防止旧列表跨连接加载同编号表单。只读取最新对象及可用用户选项；`item.actions` 仍为历史记录，`actions` 为可执行操作定义。每项含 `{id,label,enabled,reason?,mode:'native'|'external',url,description?,fields:Field[],defaults:{}}`；Field为 `{key,label,type,required?,min?,max?,step?,options?,help?,visibleWhen?}`。`scopeKey`、`version` 为不透明校验值，原样回传。
- `POST /operation` body `{kind,id,action,values,scopeKey,version,requestId}` -> `{applied:true,kind,id,action,overview:Overview|null,warning?:string}`。仅接受动作和字段白名单；提交前再次核对最新对象版本/状态，连接切换拒绝旧表单。请求ID在当前插件进程内去重（保留最近200个已确认回执，未知回执保留至重启），业务写不自动重试。结果未知的事项继续保持scope/kind/id级提交锁；重新读取上下文会把该事项的内嵌动作转为原站入口并说明核对方式。`code:'result-unknown'` 表示应先核对真实结果，不能直接重提；`conflict` 需重读上下文。应用成功后立即更新本地行、后台同步并触发详情刷新；本地刷新失败仍报告已应用并附warning。流程与限制见操作说明。
- `GET /image?id=123` -> 图片二进制，Host仅请求固定禅道附件端点，禁止接收任意URL。
- `POST /read` body `{ids:string[]}` 或 `{all:true}` -> overview。Notice.id为本地字符串，非禅道ID。
- `GET /connection` -> `{baseUrl:string,account:string,hasPassword:boolean}`。永不返回密码/Token；overview新增connection同结构。v0.1.4只读取用户通过插件保存的私有连接文件，不自动导入MCP/环境变量；首次未配置返回`{baseUrl:'',account:'',hasPassword:false}`，不发起禅道请求或启动同步计时器，Client自动显示配置表单。
- `POST /connection` body `{baseUrl:string,account:string,password?:string}` -> overview。先验证登录，成功才原子保存到插件私有连接文件并切换后台同步。空密码仅在网址/账号均不变时保留；更换网址/账号必须输入密码。失败保留旧连接。新账号scope首次扫描不通知历史。
- `GET /settings` -> Settings。
- `POST /settings` body Settings可编辑字段 -> overview。字段白名单，禁止客户端传任意站点URL或密码。
- `GET /pets` -> `{available:boolean,pets:[{id,name,display,assetRoot,animations:string[],images:[{name,description}]}],error?:string}`，从dsh-pet 0.4 `/config`读取动作和表情池名称/描述，不返回凭据或模型提示词。
- `POST /pet-image` body `{data:string}` -> `{id:string,type:string,bytes:number,url:string}`。仅接受不超过2MiB的PNG/JPEG/GIF/WebP纯base64，图片按SHA-256内容ID保存在本机；`GET /pet-image?id=64hex`只读返回图片，用户关闭插件时本机临时桌面图片服务停止。
- `POST /pet-test` body `{kind:'task'|'bug'}` -> `{accepted:true,warning?:string}` 或错误。使用已保存的对应动作/配图配置，手动测试不会读取未保存草稿。


OperationAction 的id使用命令语义（start/finish/edit/assign/cancel/pause/restart/activate/close/record/confirm/resolve/toTask），不是任意状态值。`mode:'external'` 只允许打开Host生成的同站原页，不调用写接口；原站完整表单自行执行权限和状态检查。字段可见条件为 `{key,values:[]}`；隐藏字段不提交，工时标签明确本次增量或累计。端点及版本证据见 [操作能力说明](operations.md)。

Item公共字段：kind:'task'|'bug'，id:number，title:string，status:string，pri:number，assignedTo:{account:string,realname:string}，assignedDate:string，openedDate:string，lastEditedDate:string，projectName:string，productName:string；任务额外estimate/consumed/left/deadline/execution/story，Bug额外severity/resolution/resolvedDate。

Notice：`{id,kind,itemId,title,reason:'assigned'|'created'|'reassigned',createdAt,read:boolean,delivered:boolean}`。通知按新到旧返回；未读不自动删除，已读保留最近500条；显示“新指派/新建/重新指派”。未读数取未读条数，桌宠送达与已读无关。

Status：`{syncing:boolean,lastSuccessAt:string|null,lastAttemptAt:string|null,error:string|null,petError:string|null,nextSyncAt:string|null}`。后台失败保留旧列表。

Settings：`{pollSeconds:45,notificationsEnabled:true,petEnabled:true,petId:'',petDurationSeconds:10,petAlerts:{task:{animation:'',imageType:'none',image:''},bug:{animation:'',imageType:'none',image:''}},connectionFile:string,hasCredentials:boolean}`；可编辑pollSeconds（30..60整数）、notificationsEnabled、petEnabled、petId、petDurationSeconds（5..120整数）及两类petAlerts。imageType为none/meme/upload/url；meme为dsh-pet表情池名，upload为64位图片内容ID，url为无凭据HTTP/HTTPS完整地址。connectionFile只显示不能从页面改成任意文件路径。无petId时Host选择支持desktop/both的首只可用宠物，页面显示为“自动”。

Client source `src/client.cjs` 使用 `require('react')`，最终 `module.exports={name:'zentao-ui',inject:['slots','locale','layout'],apply}`；build将其包装在DSH ModuleLoader factory内并注入常量 `STYLES`（CSS字符串）。可使用相对图片路由。Client导出`filterItems`等纯函数供node:test，但不依赖Node模块。注册sidebar.panellist(id:'zentao')、main(key:'zentao')、plugins.tab(id:'zentao')、plugins.bundle.config(key:'dsh-zentao')。plugins.tab使用owner.openPackage('dsh-zentao')复位宿主持久tab后layout.selectPanel('zentao')进入独立main，避免管理页头占据工作台上方空间及返回导航陷阱；组合包配置保持嵌入设置。任务/Bug页签徽标始终统计assignedTo.account等于当前account的个人事项总数（含全部状态）；搜索、状态筛选与“全部”范围不改写个人总数徽标，列表自身结果数另按筛选实时变化；上方待办卡片仅统计个人待办状态。使用locale.bind('zentao')，注册中英最少导航字典，界面主要中文。
