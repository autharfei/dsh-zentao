# 任务与 Bug 操作能力（0.1.6）

本版为任务列表、Bug列表与详情补充共用操作栏。插件内表单只在用户主动提交时修改禅道；打开列表、查看详情、读取操作选项和后台同步均不执行这些业务写操作。

## 支持清单

| 页面 | 操作 | 方式与范围 |
| --- | --- | --- |
| 任务 | 开始 | 插件内：指派账号、累计消耗、预计剩余、实际开始时间、备注。 |
| 任务 | 完成 | 插件内：本次新增消耗、实际开始/完成时间、完成后指派账号、备注。 |
| 任务 | 编辑 | 插件内：任务名称、优先级、预计工时、截止日期；描述与关联关系保留原站完整编辑。 |
| 任务 | 指派 | 插件内：账号、预计剩余、备注。 |
| 任务 | 取消 | 原站专用取消表单。REST v1缺少独立取消端点，通用编辑状态不能替代完整取消流程。 |
| 任务 | 暂停、继续、激活、关闭 | 插件内：按状态提供适用表单；继续使用累计消耗，激活填写预计剩余。 |
| 任务 | 记录工时 | 插件内：日期、本次新增消耗、工作后的预计剩余、工作内容。 |
| Bug | 确认 | 插件内：指派账号、优先级、备注；确认是独立标记，不是新增状态。 |
| Bug | 指派 | 插件内：账号与备注。 |
| Bug | 解决 | 插件内：解决方案、解决时间、后续指派、备注；已解决需填写实际构建ID或主干`trunk`，重复Bug需填写对应编号。 |
| Bug | 转任务 | 原站转换流程，选择执行并保留转换关联。 |
| Bug | 编辑 | 插件内：标题、优先级、严重程度、截止日期；重现步骤与附件使用原站完整编辑。 |
| Bug | 关闭、激活 | 插件内：按状态开放，激活需填写重新发现版本。 |

多人协作、团队工时及父任务汇总会切换到原站完整操作表单；不在插件中模拟团队状态机。单人子任务仍交由禅道接口执行其关联校验。

## 为什么部分操作使用原站

任务取消有独立业务语义：官方取消实现还会维护团队状态、清理来源Bug的转换关联，并生成专门的取消记录。REST v1通用 `PUT /tasks/:id` 的编辑流程虽然含`status`字段，但不能等价实现这些行为。因此本版保留“取消”按钮并打开原站取消表单。

Bug转任务需要选择目标执行、创建新任务并由禅道维护关联；本版核对的REST v1没有完整转换端点，拆成创建任务加编辑Bug会留下非原子的半完成结果。使用原站转换入口来保留完整流程。

## 使用与结果提示

1. 点击列表操作栏或详情中的动作，读取最新状态和表单。
2. 填写必填项。开始/继续的消耗填写操作后的累计总量，禅道按新旧差额记录增量；完成/记录工时填写本次新增。开始/继续时剩余填零会直接完成任务。
3. 提交前会再次读取并核对对象版本；其他人已经修改时需重新加载表单。
4. 写成功后更新当前行与统计，详情重新读取，后台继续同步。指派给他人后，事项可能自然移出“我的”筛选。
5. `已提交`与`已同步`分开。若写成功但本地更新失败，界面提示已提交和同步警告，不应重复操作。
6. 超时、断线或服务异常时可能已经写入。先“立即同步”或在原站核对结果；不要直接再次提交。请求ID仅在当前插件进程内去重；未知结果会继续锁住该事项的插件内提交，重新打开表单也不能重发，可先在原站核对。核对后重启插件可恢复内嵌操作，重启本身不能证明此前未执行。

用户列表读取受权限限制，失败时可输入登录账号，实际可指派范围由禅道校验。构建版本使用真实构建ID，`trunk`是明确选择主干，不是自动兜底。账号需有对应写权限；旧版或定制版未提供接口时会显示错误及原站入口，不静默回退到直接改状态。

## 接口核对依据

本轮静态对照官方开源源码的22.6发布标签与main分支，未调用用户站点的写接口，也未运行功能验收。

- [22.6 REST v1路由](https://github.com/easysoft/zentaopms/blob/zentaopms_22.6_20260917/config/apiv1.php)、[main REST v1路由](https://github.com/easysoft/zentaopms/blob/main/config/apiv1.php)。任务使用`/assignto`、`/start`、`/pause`、`/restart`、`/finish`、`/close`、`/active`、`/estimate`；Bug使用`/assign`、`/confirm`、`/resolve`、`/active`、`/close`。
- [任务开始](https://github.com/easysoft/zentaopms/blob/main/api/v1/entries/taskstart.php)、[任务完成](https://github.com/easysoft/zentaopms/blob/main/api/v1/entries/taskfinish.php)、[任务指派](https://github.com/easysoft/zentaopms/blob/main/api/v1/entries/taskassignto.php)。完成接口的`currentConsumed`为新增工时，由禅道加到当前累计。
- [记录工时入口](https://github.com/easysoft/zentaopms/blob/main/api/v1/entries/taskrecordestimate.php)、[表单定义](https://github.com/easysoft/zentaopms/blob/main/module/task/config/form.php)。`date`、`consumed`、`left`、`work`按并行数组发送，本版表单输入一条记录。
- [Bug确认](https://github.com/easysoft/zentaopms/blob/main/api/v1/entries/bugconfirm.php)、[Bug解决](https://github.com/easysoft/zentaopms/blob/main/api/v1/entries/bugresolve.php)、[Bug激活](https://github.com/easysoft/zentaopms/blob/main/api/v1/entries/bugactive.php)。
- [Bug转任务原站入口](https://github.com/easysoft/zentaopms/blob/zentaopms_22.6_20260917/module/bug/js/view.ui.js)。有目标项目和执行时打开带`bugID`的任务创建表单；否则打开Bug详情，由操作者点击转任务并选择执行。
- [任务编辑与状态构建](https://github.com/easysoft/zentaopms/blob/zentaopms_22.6_20260917/module/task/zen.php)、[任务专用模型](https://github.com/easysoft/zentaopms/blob/main/module/task/model.php)。

权限、自定义必填项和定制工作流最终由实际禅道版本决定。构建、语法和静态审查不等于真实站点功能测试，安装与验收由操作者执行。
