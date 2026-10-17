# App 内容服务配置与受限 runtime 协议

2026-10-17。本文描述客户端源码要求及与主线程对齐的部署契约，不代表已部署或端到端验收。

## 地址与运行模式

- `apiBaseUrl` 是 VILab 模型服务，不能代替内容服务。
- `integrationBaseUrl` 是飞书/MCP/插件服务；它不因 HTTP 可达就成为内容服务。
- `generationBaseUrl` 是显式内容 Base URL。public 配置为 `https://supabase-vinote.orulink.ai/vinote-api`，由主线程在同一 runtime 上用 `VINOTE_CONTENT_CLOUD` 显式启用受限 API。同址仅表示入口共享；客户端仍核验内容 capabilities。
- 普通 Metro Debug 使用 `http://127.0.0.1:8900`，原 dev 目录和 USB 热更新不变。Android `-PvinoteStandalone=true` 使用既有 `debuggableVariants=[]`；当前锁定 RN Gradle 插件 `TaskConfiguration.kt` 对此 bundle 设置 `devEnabled=false`，故 standalone Debug 与 Release 的 JS 都读取公网地址。`BuildConfig.VINOTE_STANDALONE` 已用于关闭 dev support，无需新增 JS native 常量。
- JSON 选择脚本、Babel 和 Release Gradle 共享同一校验。地址必须 HTTPS 公网 DNS 名，可带规范代理前缀，无凭证/query/hash/点段/编码路径。显式共用 integration 地址允许；VILab/账号根入口不允许。校验不联网，不证明 DNS、TLS 或出站安全。

## 无推理预检

`GET /api/content-service/capabilities`，要求当前 VINote Supabase 账号 Bearer。无 Cookie、无请求体、无 LLM/ASR、无 job 创建。严格核验：

```json
{
  "content_service_protocol": 1,
  "generation": true,
  "sync": false,
  "max_upload_bytes": 134217728,
  "video_url": true,
  "video_url_platforms": ["bilibili"],
  "video_source_preflight": 1
}
```

`max_upload_bytes` 必须正安全整数，`video_url` 必须 boolean。可选 `video_url_platforms` 为最多16个无重复的小写平台名：存在时严格限制已声明平台，当前App只识别开放 bilibili（含b23.tv），其余视频/媒体链接不放行；空列表禁用全部视频。video_url 是总开关，非 true 时必须拒绝全部视频；仅 true 时平台列表才进一步缩小范围。没有该字段时兼容旧device video_url=true/false行为；null/字符串/对象/重复/非法平台名均失败关闭。reason 可选，仅作服务端诊断，不直接显示给普通用户。页面显示检查中、内容服务已就绪或简洁错误及“重新检查服务”。重试仍只 GET。401 最多安全 refresh 一次；403、未部署/禁用、协议错误、网络失败不能变成就绪，不发 generation POST。

新来源提交前再次 GET，文件大小按实际 FS.stat 核验，超限在 FormData/未知提交标记前失败。服务上限和 PDF/DOCX 的20MiB取较小值。界面使用 MB 简写，实际按字节边界判断。当显式平台列表仅含bilibili时，页面恢复B站/b23.tv链接提示，其他视频提示导入文件。新来源提交和production API POST前再次核对当次capabilities；只读预检不推理。客户端检测明确视频站/媒体直链用于提前提示；服务端仍须强制视频下载禁用/出站隔离，不能依赖客户端识别。普通网页使用后端安全提取，不把任意 URL 交给 yt-dlp。

所有 production 内容 JSON 请求在原身份 lease/超时内先读 capabilities；飞书/MCP/插件不会因内容 runtime 禁用而被误阻断。预检成功仅说明 API 角色启用，不证明模型、源站、上传或生成成功。

## B站来源只读预检

可选能力 `video_source_preflight` 仅接受整数1；字段不存在兼容旧device，不增加来源请求。仅新的URL且已通过视频总开关/平台范围验证、目标为B站/b23.tv时，在operation持久化前调用 `POST /api/content-service/video-source`，JSON `{ "url": "https://b23.tv/synthetic" }`，超时60秒。返回title/video_id/duration/url；失败422/502保留安全detail（包括实际412来源受限信息），不写pending/operation，不POST generate。此POST仅按HTTP形式发送读取请求，无身份映射、任务或模型；客户端不带operation头。

原任务return/recover顺序不变，不调用来源预检；普通网页、文件上传跳过此步。预检成功仅表示当次来源检查通过，不承诺后续网络、上传或推理成功；412不等于视频本身失效。

## 客户端所需路由和鉴权

所有下列路由均位于 generationBaseUrl 后，要求同一受信任 Supabase Bearer 经验证的 owner，跨账号不可读任务、操作或图片。401 必须在有副作用前拒绝，才能使用客户端既有一次 refresh。不得通过本地文件路径或 Cookie 绕过鉴权。客户端发送 `X-VINote-Client: mobile` / `X-VINote-Platform`，仅为备注，不授权。

| 路由 | 客户端合同 |
| --- | --- |
| GET `/api/content-service/capabilities` | 上述无推理合同；缺字段失败关闭 |
| POST `/api/content-service/video-source` | 仅新B站来源的只读检查；Bearer，body={url}，60s；无身份映射/任务/模型，失败422/502返回安全detail；不发送operation头 |
| POST `/api/generate` | 明确用户操作；JSON `video_url`、platform=auto、workflow=note_organization、style=detailed、summary_mode=default、output_language=zh-CN。字段名 video_url 为兼容接口，普通网页也走此字段；未获平台能力允许时不可用它启动视频下载 |
| POST `/api/generate_from_upload` | multipart file/source_type/title及上述总结选项；按 runtime max_upload_bytes，PDF/DOCX还限20MiB；不接受服务端本地路径 |
| GET `/api/source-requests/{operation_id}` | 原 owner 精确操作回执，须返回相同 operation_id、有效 task_id、reserved/accepted及来源类型；reserved/未知只查询，不重发，不改绑最新任务 |
| GET `/api/task/{task_id}` | 精确 owner 状态、message、progress/retryable及成功 result.title/markdown；源记录本机保存，generation Origin 改变不能查询新地址代替原地址 |
| GET `/api/task/{task_id}/model-confirmation` | 旧来源缺快照的只读模型确认上下文，必须保留原任务/owner/Origin；打开页面不提交 |
| POST `/api/task/{task_id}/retry` | 仅用户明确确认、原任务允许且原 lease 有效时；冻结模型，必要时 confirmed/mode/server_url/asr_model/llm_model；无自动重试、未知结果不能重放。本轮手机验收禁止此操作 |
| GET `/api/task/{task_id}/artifacts/screenshots/{name}.png|jpg|jpeg|webp` | 仅归属该 owner 的固定图片，后端必须校验真实图片及路径；无任意文件、原始媒体或目录列举 |
| GET `/api/task/{task_id}/artifacts/media/{name}.png|jpg|jpeg|webp` | 客户端保留的图片兼容路径；受限 runtime 若不支持，返回明确404/403，不能开放原媒体下载来迁就旧正文 |

生成 POST 带本机预先持久化的 `X-VINote-Operation-Id`；返回 task_id，支持时返回同 operation_id 与 reserved/accepted。网页/文档回执能力与历史媒体/视频幂等能力不同，不能宣称所有来源去重完善。传输失败与未知接收不自动重发。

图片由现有 ContentImage 原生文件下载读取到账号隔离临时缓存，校验200、PNG/JPEG/WebP MIME、非空与5MiB上限，离页/账号或正文变化清理。不把 Bearer 交给任意外链图片；外链需逐图确认且不带账号凭证。截图不要求上传正文附件或同步；workspace JSON 路径仍410拒绝。FS 原生下载的真实 TLS/redirect/平台行为仍需包验收，源码限制不等于已测完第三方原生下载。

## 部署与验收边界

主线程负责启用 runtime、路由 allowlist、Bearer-only、私网/本地路径/文件库与 workspace 禁止、出站提取与上传限制。App 仓库本轮不修改后端、不部署、不实际请求云端、不执行ASR/LLM。

计划无推理手机验收：打开笔记导入页检查 public capabilities 就绪；失败时只点重新检查；查看已有笔记、编辑保存、重开。不得点生成、旧任务生成重试或录音处理。本轮仅实现B站平台声明的客户端支持，后端开放/下载出站隔离和B站完整生成仍待主线程核实；普通网页/PDF/Word/媒体上传的完整生成均未由本轮验收。iOS 原生/真机未验证。离线测试与 GitHub CI 不能替代这些事实。
