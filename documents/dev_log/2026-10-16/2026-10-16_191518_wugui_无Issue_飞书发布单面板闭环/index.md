# 飞书发布单面板闭环

- 建档：2026-10-16 19:15:18 Asia/Shanghai；git config 作者 wugui；实现参与者 Codex。
- 状态：本机源码修改及离线回归；未提交、构建、部署、设备操作或实际发布。
- 用户授权写集：App 飞书发布面板、相关 API/回执/必要组件、测试及本档案。ASR、录音、账号和同步不在本轮写集。

## 目标与证据

原序列在持久化 unknown 后调用 publishToFeishu；该函数再次检查本机插件，可能零 HTTP 请求即抛错，使草稿永久 unknown。不能用错误字符串、持久化 not_dispatched 或历史 404 解除这个保护。用户提供公网 grant verified/capabilities=true，不将发布失败误归因于缺少 OAuth。

用户要求面板显示保存标题、已连接账号、自动只读位置校验、可折叠的通知对象和唯一固定底部创建按钮；面板信息即明确确认，不添加二次 Alert/核验复选框。插件启用必须显式点击，已有授权复用；新请求与旧 workspace 来源隔离。

## 实现与边界

- FeishuDeliveryPanel 自动核验绑定 owner、identity epoch、integration Origin、正文/位置/对象签名和请求代次；失败内联重读，迟到结果不能批准新位置。通知标题及底部摘要展示真实姓名/群名，仅本人默认时高级选择保持折叠。历史未知没有姓名证据时不套用当前连接姓名。
- 显式“启用飞书插件”复用现有 account-scoped store 写 installed/enabled，重读并检查 owner/epoch；不调用 OAuth。BottomActionSheet 的 footer slot 位于滚动区外，保留 SafeArea 和既有 48dp 关闭/返回。
- feishuPublishAttempt 以进程内 WeakMap token 将准确 payload/owner/Origin/epoch/operation 与最后一个 preflight 绑定。只有本次 preflight 的真实异常、未交 HTTP 且当前指针/归档都等于原 intent 时，可恢复同一 operation 为 draft。HTTP/token 通路异常、伪造错误、历史 unknown、跨账号及已消耗 proof 均不能解锁。
- 新 draft 持久 publicationKey=publish:<noteKey>；HTTP 发送 source_mode=local_snapshot，不提交 workspace version_id/revision_id。历史 frozen/unknown 的原 key、输入、对象、policy 不迁移。
- 对齐后端最终合同：仅新草稿的联系人/群选择冻结 recipient_access_policy=grant_view_and_notify，签名包含 policy，要求 status.recipient_access_protocol===1；仅本人兼容旧服务。说明仅 view 授权及链接通知、失败保留文档/已授权。联系人 selection_token 协议不变。
- permission_unknown / reading_permission.granting、unknown 阻断普通 retry。显式“核验阅读权限”调用原 job 的 POST verify-permissions（语义为外部 GET ACL + 本地证据保存，不授权、不发消息、不排 worker）；结果 id/owner/epoch 必须匹配。核验为 verified 后仍需显式“继续通知”；并存 message/body unknown 时不能继续。
- 保留原精确回执查询、失败收件人重试、正文预览/导出、显式新版及文档恢复。没有新增默认自动发送。

## 验证记录

采用实现后的缺陷定向补测及原回归调整，未声称预先完整执行 TDD。串行 Node192 Jest、Node256 TypeScript；无 Gradle/Cargo/Metro/设备/外部服务操作。

1. attempt/preflight/receipt 初次 3 组 18 项通过。
2. 单面板、Feishu/API/回执、插件和 MeetingDetailWorkspace 22 组 151 项通过（12.692s）。新合同 API 全部 mock；覆盖历史 unknown/404、已发送通知不重发、权限未知保护。
3. 姓名摘要与仅本人折叠补充后，flow/contacts/review 3 组 23 项通过（5.395s）。底部位于 ScrollView 外、显式启用无 OAuth、迟到响应、缺 cap1、核验后不自动通知均有断言。
4. tsc --noEmit 已通过；收尾结果见下方追加。

收尾冻结：姓名摘要、历史 unknown 姓名保护、新 policy 指纹/载荷与旧冻结不迁移补测后，同一串行命令 **22 组 153 项通过（10.891s）**，随后 Node256 `tsc --noEmit` exit0。Jest Settings 既有定时器 mock 打出 TimeoutNaNWarning，未造成失败；未据此修改无关设置组件。此后冻结产品源码，等待父任务重载/真机验收；本轮没有执行任何真实飞书授权、文档创建或通知。

### 实机 ready 截图反馈后的最小 UI 收尾

用户实看反馈重复文字/导出混杂后，明确授权 UI 精简：MeetingDetailWorkspace 专属 Sheet 标题改“发布到飞书”，详情页原有导出不变；发布面板删除重复导出及附带逐字稿选项，顶部只显示标题、账号、实际位置状态；正文预览折叠，固定快照、权限/格式解释收进“发布详情”；通知姓名摘要只显示一次，footer 仅一句确认与按钮。请求/入参/协议/查询/重试逻辑不变。

精确 completed 且 ready、账号/Origin/epoch、acknowledged receipt.jobId 与当前 job.id 匹配、无 pending/unknown/recovery 时，底部改“打开飞书文档”，移除重复正文打开入口；保留显式准备新版按钮。点击时重新只读核对账号及原 operation/job/epoch，不新增 API 请求。旧回调在重新登录后不能打开旧结果，latest-only/错回执/unknown 不能冒充此完成态。

本次串行小回归 `FeishuDeliveryPanel|MeetingDetailWorkspace|NoteDetailScreen` **8 组 62 项通过（5.269s）**；包括唯一通知摘要、默认折叠/无导出、完成态切换与身份隔离。未触发任何真实发布/模型请求或设备操作，产品源码再次冻结供主线程实看。

收尾 TypeScript 发现新增测试的宿主 Text 类型比较不兼容，已仅将测试判断改为 String(node.type)，随后 Node256 `tsc --noEmit` exit0；产品源码未再变更。

## 关联与未验范围

补充 [飞书身份显示](../../2026-10-14/2026-10-14_001744_wugui_无Issue_飞书界面隐藏技术身份/index.md)；该历史姓名展示与冻结合同继续保留。后端由另一任务负责，源码对齐不代表已部署；实际账号授权、外部 grant/通知、真机布局和阅读权限仍由父任务验收。
