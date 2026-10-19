# App 笔记模型来源修复

- 作者 wugui；参与者 Codex；2026-10-17 Asia/Shanghai。
- 基线 b2cd99b；分支 codex/fix-app-note-model-origin；进行中，未构建、部署或合并。
- 用户授权仅本工作区修改/离线测试/提交推送 PR；版本保持 0.1.4，不调用 ASR/LLM，不改 live 和发布工作区。

## 问题与边界

旧 intake 将 LAN 目录选择的 ID 交给公网 worker，实际模型 Origin 仍是服务器固定公网地址。两包必须同功能，全部模型请求由 App 直连各自 API_BASE_URL，账号/飞书和纯提取服务可共享。新操作 owner/Origin/model/source/checkpoint 持久冻结；推理未知不得重放，旧云任务只读恢复、不迁移。

## 计划

新增最小客户端笔记流水线，复用现有 ASR 传输/检查点及 chatCompletion，使用笔记提示词，不调用会议总结/说话人；纯提取协议由 root 提供。来源关联标记 client 执行，保存失败复用正文。先定向离线测试，发布构建期间不跑全量。

## 历史关联

替代 [0.1.4发布收尾](../2026-10-17_160000_wugui_无Issue_App014发布收尾/index.md) 中混合模型 Origin 的内容执行设计，保留共享账号/飞书及版本/guard。


## 实现与验证（提交前）

- 新增 clientNotePipeline：账号命名空间独立记录、固定 Origin/模型/文件 SHA-256 或 URL 与提取 hash、真实转写检查点及推理前 marker。新操作 claim 在首读前建立；进度/前后台只读，未知不重发，同来源不能新建 UUID 绕过。已有完整转写和笔记结果不会因保存失败重做。
- noteIntake 新提交只进入设备流水线；旧 task/operation 仅原 GET、成功保存，无迁移/ASR/自动 retry。文件关联追加 execution/client 与 modelOrigin，不改变旧关联。旧安全时间戳录音 ID 保持兼容，操作 UUID 仍严格。
- 普通网页/文件只使用 root 纯提取协议，multipart 仅 file，不带模型字段；文本/PDF/Word/字幕/JSON 不运行 ASR/speaker。媒体和设备 B站下载不再依赖公共生成服务就绪。
- 笔记使用 chatCompletion 专用提示词。核验当前 OpenAiStream.finish 的真实 ChatResult/choices 合同，没有按猜测改为字符串；真实 SSE 收集器测试通过。保存继续用 saveSourceNote 的 summaryTopic 命名，无新增标题调用。
- 修改前测试：新模块缺失使新增合同测试不能加载，明确反映缺少设备笔记执行路径；随后定向测试驱动补齐实现。旧云 POST 测试被新直接模型/纯提取测试替代，旧 GET/unknown/保存/账号保护继续覆盖。
- 验证中修正：新增存储失败测试自身递归 mock 已修复；FormData 测试适配 Node keys 合同而非 RN getParts，未改产品协议；ASR marker 恢复类型显式标注 ClientNote，tsc 再次通过。
- 最终定向禁网 Jest：12 suites / 182 tests passed（单worker，Node384）；包含真实 SSE collector 的两包同 ID 不同 HTTP Origin、ASR相同ID不同 WS Origin、文件提取6格式、未知/并发/账号切换/存储失败/旧云只读/来源关联/界面。
- 17 项禁网 Node 脚本检查通过；Node256 TypeScript --noEmit 通过。`git -c core.whitespace=cr-at-eol diff --check` 审核仓库既有 CRLF，通过。
- 未跑本机完整 App 套件，避免与发布资源冲突；PR 的远端离线 CI 将执行完整套件。本轮未构建、下载模型、调用真实 ASR/LLM、操作设备或修改其他工作区。
- root 纯提取接口由独立任务交付；协议字段已按 {extraction_protocol,title,text,source_sha256,source_type} 接入，缺失/无效时失败，无旧 worker fallback。未宣称接口部署或两包实测通过。


## 提交后安全复核

发现同字节媒体复制到新路径后，完整指纹比较会把它视作新来源。补充以文件 SHA-256+size 识别未知请求别名，不能通过改路径和新 UUID 重发；仅对已有未知请求阻断，不迁移旧任务或替换正常待执行原件。追加离线反例（新路径、新UUID、相同字节），mock模型调用计数仍为1。定向累计183项，版本/协议未扩大。首个提交a4bd8ba的远端CI仍并行中，最终以PR最新HEAD检查为准。


## Review：未知结果的显式退出

- 原界面已有terminal“更换来源”，并非完全没有出口，但旧实现清slot没有expected selection复核，可能清掉新的输入。新增leaveClientIntake和明确“保留记录，整理其他资料”确认，owner级串行写，精确比较operation/task/modelOrigin/models/来源及冻结记录；只清当前槽，source-request归档、设备完整记录和未知marker逐字保留。
- 保存完成清槽也改为同一串行expected-selection条件，晚到旧结果不清新来源。正常query/返回/前后台不退出或重派发；不同资料可显式新建，同字节未知拦截保留。
- 新增真实mock LLM断线→unknown→显式退出→不同来源新操作（旧调用不增加）、同源仍阻断、5类stale selection、并发写/保存、账号切换、UI显式确认反例。非手写request掩盖链路。
- 定向最终12 suites / 192 tests通过，Node384单worker禁网；tsc通过。此前c81提交的全量CI结果不代替本次最新HEAD检查。


## Darwin独立review：d9cce33的三项反例

用户转述独立reviewer的内存真实模块复现：fragment别名使同正文LLM2次；B站clientpending→associationprepared→source-request写失败使HTTP0仍无法补齐；LLM marker后gate checking在HTTP前拒绝却永久unknown。本次针对性修复，不改服务端或版本。

1. URL规范化去fragment并兼容历史原URL比较；正文提取后按source_sha256或实际相同正文扫描同owner未知别名，owner级串行claim后才写LLM marker。新增fragment、不同URL同sha、不同URL同正文但sha不同三种反例，LLM计数均保持1。
2. 新增recoverPreparedClientNote，要求原clientpending、owner/Origin/source一致，且无active worker/转写/正文/结果/inFlight。B站prepared关联和缺失receipt仅能补齐同一操作；真实首次submit制造receipt写失败，确认ASR/LLM/提取均0，再次显式submit同operation只执行1次。已有派发证据拒绝恢复。补回B站operation与file.id一致校验。
3. textStream在xhr.send调用前提供sendAttempt证据，apiTextStream将remoteRequest创建也纳入边界；只在从未send时抛ModelRequestNotSent。保留SESSION_NOT_VERIFIED等原code；pipeline按类型而非文案清LLM marker。真实sessionGate→remoteRequest→api→textStream→XHR测试：checking前HTTP0可明确继续；send后checking HTTP1保持unknown不重发；XHR setup失败HTTP0同样可继续。

- 此轮修复后新增/补强回归，未伪称全部先写测试；Red来源为用户转述Darwin对d9的复现。旧“不同来源”fixture原本给了相同正文/hash，已改为确实不同正文，保留独立相同正文别名反例。
- 最终本地定向：16 suites / 296 tests passed，Node384单worker、全程offline guard；包括14套件218及apiAccount/sessionGate两套件78。TypeScript通过，diff按既有CRLF规则通过。
- 新传输错误边界未改HTTP刷新/服务地址/Token存储；类型保留原账号错误code。没有真实网络模型调用、原生构建或修改其他checkout。最终CI以本追加提交为准，仍等待独立复审，不合并。

## 后续变更

2026-10-20｜补充：[App会议原件与生成确认](../../2026-10-20/2026-10-20_002225_wugui_无Issue_App会议原件与生成确认/index.md) 为新 intake 增加本次模型显式确认并冻结，不改本档固定 Origin/unknown 不重放合同；原件保存和视频预览为独立本机能力。仅源码/离线，未发布。
