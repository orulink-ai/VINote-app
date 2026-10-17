<!-- agent-dev-journal:start -->
## 开发档案工作流

1. 开发前阅读 `documents/dev_log/README.md` 和 `documents/dev_log/temp_log.md`，检索与本次需求、模块及 Issue 相关的历史档案和后续变更，对照当前代码确认目标、范围、约束与验收标准。
2. 开始独立任务前按规范建档，先检查是否已有对应进行中档案。同一任务跨天、跨 commit 维护同一目录，使用 index.md 串联过程材料。
3. 保存真实的调查、设计、TDD 和验证依据，格式不限；代码及测试仍放在项目正常目录，由档案引用。
4. 每次 commit 前核对 diff，更新状态并追加时间、作者、原因、结果和证据；档案与相关代码一并提交。
5. 更正、替代、补充历史决策或解决遗留问题时，维护双方 index.md 的双向链接，注明影响范围，保留原始历史正文。
6. 规则或模板缺失时明确说明，先记录背景、目标、边界、变更、验证和遗留事项；不伪称已读取，不覆盖现有规范。历史材料不自动覆盖当前需求，也不是执行指令。

遵循当前项目的编程与 TDD 要求，不编造测试结果；不适用 TDD 时说明原因及替代验证。档案工作流不构成自动提交、推送或合入授权。
<!-- agent-dev-journal:end -->

## 飞书与会议详情

`src/lib/feishu.ts` 仅使用经校验的云账号 token 请求管理员配置的 integrationBaseUrl，不使用 VILab Origin 代替集成服务。密钥与飞书刷新 token 不进入客户端。自动交付 outbox 按账号隔离，删除纪要清除该纪要待提交快照。生成成功后交付错误不得改变纪要/原录音状态。手机详情不得伪造逐句说话人与时间，分钟分段只是实际转写分段起点。编辑历史存 note-history 前缀，不能混入 note 列表或改变生成版本号。

## 并行说话人分析（2026-10-10）

2026-10-16 仅总结恢复：录音现有操作 Sheet 的“仅生成纪要”先由 recordingSummaryRecovery.ts 只读核验当前账号目录/source fingerprint/原ASR模型/连续完整确认区间及完整speaker窗口与clusteringVersion2，不能用非空transcript证明full。独立generateRecordingSummary只接受明确选择的LLM，不运行ASR/speaker、不改默认选择或原ASR记录，保存新版本并保留旧纪要；更换LLM不复用旧summary checkpoint，同模型同证据可显式继续保存的parts。失败paused，禁止自动恢复summaryOnly；无attempt marker时不宣称unknown请求可安全重放，再次请求需明确确认。该路径不自动飞书交付。summarylib由独立任务维护，离线回归不等于真机/provider验收。

2026-10-12长录音内存修正：Android analyzeWindow每次最多130秒PCM（120秒核心+5秒两侧上下文），逐窗释放engine；JS按源指纹保存完成窗口和绝对偏移，不将各窗局部编号当同一人。超过十分钟或时长未知的录音先保存ASR再分析说话人，另一分支失败仍保留独立成功检查点。无新原生能力的长录音不得回退whole-file分析。原件保留，4suite29 tests/AppTS通过；未构建安装或测量新真机峰值，不能宣称系统不会LOW_MEMORY。2026-10-17补充：iOS源码已补analyzeWindow，SpeakerAudioRange.h校验规范WAV和采样对齐区间，只分配单窗float、定长缓冲读PCM，空静音窗可保存覆盖，旧analyze同受资源预算限制。130秒是与Android一致的单次分配预算，不是模型或整段录音时长限制。C核心离线测试不等于Objective-C/Pod/Sherpa运行通过；仍待macOS构建和iOS真机验收，必须重建原生包。详见当天iOS分窗档案。

2026-10-13 转写：取消按模型名选择12/60秒请求。所有已配置 VILab ASR 使用同一 VLA2 PCM 流式协议；只根据服务明确返回的会话限制续接，不从断网/502猜测限制，不切换模型。v5检查点按来源指纹、模型和已确认起止区间保留证据，兼容同源已确认的旧检查点。实时进度与已保存区间分别展示，只有最终结果落盘后才显示完成。录制期间仅录制，结束后转写与独立说话人分析并行，两者完成再总结。自动纪要图示停止；飞书插件安装/启用与账号授权分开。公网Aliyun 120/340秒真实调用已成功；这不是手机完整长录音验收证据。

`meetingSpeakers.ts` 管理本机分析、源文件检查点、重叠区间与 LLM 独立证据。`generateRecording` 使用 allSettled 等待转写/说话人两路完成，串行落盘避免覆盖另一份检查点；失败不删除成功分析或原件。两份完整材料传给显式选定总结模型，SummaryCheckpoint v11 避免复用旧分段提示词结果；最新全文合同见下文。分钟转写不直接附一个确定说话人。改名仅作用本次录音，不改写已生成纪要或飞书文档。

Android `MeetingSpeakers.kt` 使用固定版本 sherpa-onnx 与打包模型；iOS `MeetingSpeakers.m` / VINoteSpeakers Pod 使用官方静态框架。构建脚本校验模型及官方 iOS 归档 SHA-256，原件只读、分析缓存最终清理。完整原生分析暂限两小时内录音，最多一份本机分析，推理两线程；Metro maxWorkers=2。Windows 未构建/验收 iOS。新原生模块必须重建安装，不能把 Metro Fast Refresh 当作原生更新。

`speakerClustering.ts` 以最多 128 个持续发言与 128 个补充窗口执行有界特征修正；每窗不超过 8 秒，原生单批不超过 128 窗，流与提取器 finally 释放。特征向量不得持久化、追踪或传给 LLM。修正前先保存已有发言区间，修正成功带 clusteringVersion=2；检查点过期时可重用相同源的区间，不能把原始数百个簇作为参会人数。声音组至少需要两段代表发言、累计有效特征时长六秒，孤立短声音保持未知；被拒绝组的中心仍作为竞争证据，防止硬归到有效组。新组 ID 使用 speaker_r2 前缀，不能自动套用旧组改名。聚类可靠标记仅为算法阈值，不代表身份准确性。

`recordingProcessing.ts` 管理单生成任务及跨页面进度订阅，`useRecordingProgress` 仅显示当前账号记录；任务释放清空进度。Metro blockList 只排除项目根 android/ios/documents，不能误排 JS 或品牌资产。JNI 进度回调使用显式 Function3 对象，保持 invoke(IIJ)Ljava/lang/Integer;，不得用 Kotlin indy lambda 替换。

设置核验授权时保留未保存通知草稿，群服务错误独立显示；状态读取失败可重试且不清空草稿。只有 preferences 写入失败才显示保存失败。会议对话的空白回答视为失败，保留问题供重试。工作台丢弃过期读取结果，后台读盘不可并发堆积。

## 界面与录音控件

2026-10-12 文件库：一级为会议资料/笔记资料，二级仅全部/音频/视频/文档。录屏是视频的真实来源标签，不是并列格式；未保留录屏原件时不制造条目。录音属于会议，新导入保存明确 purpose/source；NoteIntake 导入固定为笔记资料，文件库按钮随分区明确用途。旧文件缺用途单独待确认，owner/fileId 绑定的 .purpose.json 只记录分类，不移动原件、不改 source/task/note 关联或正文。会议页“查看录音与会议资料”直达会议原件分区，再进入原录音详情生成，不把原录音当已生成纪要；原件操作仍在文件库。界面不展示 operationId/taskId。已完成7组69条聚焦回归和App TS；未构建、安装或实际手机走查。

Text 从 components/AppText 引入，theme.fontFamily 与原生 VINoteSans/NotoSansSC-Regular 注册对应，保留系统字缩放，不修改系统主题。字体许可随 assets/fonts 分发。录音暂停/继续与标记使用真实原生状态，recordingTimer 只累计实际录音；标记属于该录音。Settings 和 BottomActionSheet 保持44dp以上可触目标。飞书配置缺失使用 FEISHU_NOT_CONFIGURED 状态，不能把它作为网络错误循环重试；网络/保存失败仍需保持草稿，底部导航离开也必须处理未保存修改。


## App v2 工作空间与视觉分区（2026-10-11）

2026-10-12 cached display reads: `getNote()` defaults to fresh storage for editing and CAS. Only explicit `mode: 'display'` can use a serialized per-note LRU (16 entries, 4 MiB payload limit); list reads remain fresh and may warm it using the pointer returned by the actual snapshot read. Reads bind owner, session generation, auth and workspace origins; pointer/local-value changes invalidate the projection and late results cannot fill a new account's cache. Missing or different `serviceOrigin` is unverified, never attributed to the current service or shown as an empty successfully-read library. Keep old storage/baselines for recovery. Dev read timing is opt-in and anonymous; default off.

Root verification (2026-10-12): `useTrustedSession` may expose local content while verification is pending only after an earlier successful identity check persisted a matching owner/AuthOrigin/integrationOrigin proof. Missing proof never means an empty library. `sessionVerifier` uses one 8-second AbortSignal deadline for `/user` plus at most one credential refresh, without Promise.race; native credential/storage operations are awaited, not abandoned. Credential refresh advances storage revision but not identity epoch; login/logout does advance identity epoch. The current verified lease is required by all business API, integration, streaming, sync commit and private-image reads; backgrounding, new verification or identity change invalidates prior leases. Local drafts/original playback/export remain available under trusted ownership. Manual verification retry performs identity verification only; normal boot/foreground synchronization resumes through the existing CAS protocol after verification. No MCP/source/Feishu unknown execution is automatically replayed. Legacy Feishu outbox records without an operation id stay intact and explicit recovery reports pending verification instead of POSTing. Account proof must not rewrite old workspace Origins or CAS baselines. This is locally regression-tested code, not a claim of device, deployment or full-product acceptance.

2026-10-12 接续约束：`intakeHistory.ts` 只读当前账号/内容生成 Origin 的真实来源回执，TasksScreen 的“当前来源任务”不是全量档案；Root 与 NoteIntakeScreen 再核对精确恢复目标，进入页面不能重新提交。`workspaceSyncTarget.ts` 精确定位原同步操作；`WorkspaceSyncSection` 首读不显示假零计数，唯一比较 Sheet 使用 `syncMergeDraft.ts` 保存原账号/服务/operation 草稿，关闭保留，基线变化需重新比较，只有成功回执才移除待处理。

正文操作按内容工具、版本与来源、整理与管理划分；历史名称按真实 kind/revision，不能猜生成版本。TextNoteScreen 区分读取、草稿保存、模型生成与正文保存失败；保存重试复用原正文与 draft ID，不再次调用模型。飞书发布通过原 operation/job 回执恢复固定正文、位置和真实通知对象，不改绑最新正文或自动重放未知写。全文翻译作为 MCP 工具仅中英，显式核对服务、语言、模型与固定原文后执行。实际结果和未验范围同步主仓库复验记录及本开发档案，不把 HMR 当原生构建或全产品通过。

最新导航替代下文早期“内容／项目／我的”：底栏为会议与笔记／文件库／插件；会议与笔记内切换会议和笔记，头像进入账号与设置。文件类型只作页内筛选；插件内为飞书与 MCP 工具，不另设重复的插件管理页。账号安全、会话管理、隐私和路径迁移未验收，不伪装成现有能力。详见主仓库 `docs/plans/2026-10-11-workspace-v3/navigation-final.md`；下文历史数据、证据与弹层约束仍适用。

笔记页直接显示“写笔记”、“粘贴链接”和“导入文件”。`NoteIntakeScreen` / `noteIntake.ts` 使用内容处理服务 Origin 和本账号 Bearer，支持公开视频 URL、普通公开网页、PDF、DOCX及音视频／TXT／MD／SRT／VTT／JSON；登录文档、扫描件、加密 PDF、旧版 DOC 给出失败与替代操作，文档上限 20 MB。按账号保存 task_id，查询或本地保存失败恢复原任务，提交回执未知不自动重发；前后台切换只恢复查询。笔记入口音频通过 keepAudioInFiles 保存为 LocalFile，不自动创建会议录音。`saveSourceNote` 以服务 task_id 去重，不把服务 task_id 当本机录音 ID；无逐字稿／本机录音的普通笔记不显示空录音控制和逐字稿。

`localFileAssociations.ts` 持久化当前账号的真实 file ID、operation ID、内容处理 Origin、task ID 与已保存 note ID。登记前核对来源元数据及文件大小；不能从标题或旧正文猜关联。提交未知只核验原操作；保存正文及关联成功后才清理来源回执，失败保留以继续核验。文件库点击关联正文时重新核对当前账号和未删除正文，不把远程 task ID 当本机录音 ID；原文件仍仅保存在来源设备。`formatDuration.ts` 显示实际录音时长，不把 42 秒四舍五入为一分钟。

`MeetingMarkdown` 的图片规则使用全宽块容器；外链图片逐张确认后加载，说明、状态与重试保留，账号/来源/正文切换重置确认。当前设备截图仅允许固定任务图片路径并按账号读取；原始文件、模型凭证不作为图片附件或普通同步数据发送。

导航为内容 / 项目 / 我的，由 App 根组件唯一拥有。详情、飞书与 MCP 等流程页隐藏底栏。ProjectsScreen 从真实 project 元数据派生过滤视图，项目→内容→详情返回保留项目上下文。本机原件从内容或我的进入，不复制完成纪要为录音历史；旧 RecordingWorkbenchScreen 已删除。全局任务入口在三个主页面均可进入，返回实际来源页。ScreenHeader 是唯一页面标题区；我的区分账号、模型、数据、原件、连接与外观，飞书/MCP 归连接目录。卡片无障碍标签只含标题/状态，不含整段纪要。BottomActionSheet 管理单任务与内部步骤，系统返回先回上一步；目录读取失败保留位置并重试同一目录。
`integration.ts` 区分公网 workspace/飞书/MCP/内容插件与内容生成服务；前者使用 deployment.integrationBaseUrl，DEBUG 内容生成使用 loopback:8900（USB reverse），release 内容生成目前未配置，不得宣称独立公网生成已完成。Bearer 支持一次安全 401 refresh。workspaceStorage 保存账号隔离的文件系统缓存与源映射，AsyncStorage 只保存小型索引，workspace.ts 通过严格字段映射写入元数据和转写，绝不上传原音路径。版本 evidence_revision 只读；历史证据按引用读取，无引用明确说明。来源日期用 source_created_at，不把首次同步时间当历史日期。所有生成与编辑历史保留，列表按录音聚合。登录/恢复只做文本同步，不自动重跑语音。

动效参考 Amicro 的画布/卡片层级、pill 与 cubic(.16,1,.3,1)，使用 React Native Animated 原生驱动；不安装其网页 gallery/CLI。Uiverse JkHuger 条形 scaleY loader 仅忙时使用，最多四轮，AppState inactive/background 时停止，active 后恢复短动画。正文不逐字动画，系统减少动效开启时静态显示。保留系统字缩放和至少 44dp 触控目标。详见本次开发档案的来源与验收边界。

## 2026-10-12 App per-item sync policy
New content defaults to local-only. itemSyncPolicy persists owner + integration Origin + canonical content key and auth Origin; a pause stops this device's future send/receive, retaining other devices/cloud and device originals. A mapping/cache alone does not authorize sync: only explicit selection or a matching prior ACK signature/revision/service proof does. runSync filters authorized items before capability checks, mappings, attachments or PUTs. Policy transitions invalidate in-flight preparation/readback/commits. Exact operation receipt queries never replay unknown writes or substitute latest text, and 404 does not clear intent. Old-format unknown pending stays frozen; an ACK query does not automatically dispatch remaining versions or resume synchronization. Existing keys stay unchanged; new content_id is assigned at first save, distinct from task/version IDs. A real localRecordingId mapping preserves current-device playback without trusting remote media_id.
Only a successful recognizable legacy status response may show unsupported protocol. Missing/unreadable capabilities or identity-gate failure remain unverified; no body is sent. Backend /import-local now requires nonempty explicit keys and sync_authorized=true. Originals never pass through workspace sync. A local-only note's cloud-key-dependent version generation remains a capability gap: do not silently enable sync to make it work.


## 2026-10-12：取消跨设备同步（最新用户方向）
本节替代上文同步策略。App会议与笔记由设备资料库管理：登录/前台/列表/保存不发workspace请求；integration边界拒绝所有/api/workspace路径，附件准备不下载或上传。原cache、pending正文/remaining版本/conflict转换为可读资料和历史；旧操作与baseline独立归档，不重放，也不猜未缓存正文。删除进入设置→存储的回收站，恢复保留ID/历史/原文件。详情直接显示编辑、删除、导出、分享；Auth/模型/Feishu/MCP仍通过既有服务与账号门禁。飞书新POST明确提交冻结正文，不用旧cloud version/revision替代输入。图表服务直接正文接口未接入，不能宣称新生成可用；旧结果可另存。
本轮串行Node512聚焦localOnlyLibrary/notesOwner/useTrustedSession/NoteDetailScreen共4suite31tests通过，App tsc --noEmit exit0；未操作手机、重启服务、清理账号或部署。此前refresh补丁仍停在待独立验证，不将本轮31tests混记为其验证。


## 2026-10-14 旧来源任务模型确认

NoteIntakeScreen 的旧任务缺模型快照 409 使用 `/api/task/{id}/model-confirmation` 只读上下文 Sheet。用户明确确认前核验 owner/identity epoch/task/operation/generation Origin 与服务/ASR/LLM，确认正文直接提交到原任务 retry；不可用或缺协议阻断。retryUncertain 在 POST 前持久化，未知写入重进也只查询，不自动重放或套用默认模型。上下文改变需重新核对。源码聚焦 Jest 单 worker 6 suite58 tests 与 App TypeScript 通过；未重建或真机验证。见 documents/dev_log/2026-10-14/2026-10-14_Codex_旧任务模型确认/index.md。


## 2026-10-16 录音服务预算分段（最新转写合同）

2026-10-16 全文纪要与仅总结恢复：默认完整 ASR/speaker 文字证据生成 draft，再整体 audit（SummaryCheckpoint v11），不按固定字符数自动提取分段事实，不自动重试推理。`recordingSummaryRecovery.ts` 只读校验当前 owner、来源 size/mtime、连续完整确认区间、同源完整 speaker 结果；`generateRecordingSummary` 是显式只选 LLM 的独立路径，不调用 ASR、PCM 转换或说话人分析，不改原模型/证据和全局偏好。结果另存新版，旧版保留；该路径不自动交付飞书。失败 paused 不自动恢复，未知推理再次请求必须明确确认。纪要已落盘而录音元数据保存失败时，先核验原版本、模型/材料与 audit 正文再恢复元数据，不能重放 LLM。完整覆盖显示完整转写时长，不用 floor/ceil 制造差一秒。2026-10-16 手机 DeepSeek 22m57s 既有资料实际总结/保存 v2/重开成功，ASR、speaker、原 transcript 哈希不变；这不是新的 App ASR 验收，详见当天 App 全文总结档案。

总结与ASR分段是独立策略：下文预算仅用于ASR，不得据此拆分默认全文总结。

`recordedAudioPolicy.ts` 只接受目录 `capabilities.recordedAudio` 的 protocol=1、supported=true、strategy=adaptive_pause、policySource=service_budget 与 640..64MiB 偶数 PCM 字节预算。它是服务调用方式，不是模型时长限制；缺 policy 阻止新音频，不以模型名推断。`recordedAudioPlanner.ts` 复用已有专属PCM reader，每批<=6400B并明确关闭句柄，批边界与320-sample分析hop对齐；没有新native接口。当前react-native-fs Android read没有close输入流，禁止用其绕过原生6400B上限；Android缺native-session时失败关闭。64k优化需后续原生变更，本轮不实施。与Python严格同算法：每窗先更新running peak，quiet阈值 max(64, peak*.001)；仅frameStart>=first+floor(maximum*2/3)进入search，quietest<=取最近窗中点；quietrun>=3840samples时逐窗更新bestPause=(run_start+end)//2，有声重置run但保留latest bestPause。无tail数组/二遍global peak，不整文件载入；核心区间连续无重叠、采样对齐，最后不超过budget的区间直接end。共享fixture为__tests__/fixtures/recorded-audio-boundaries.json，脚本scripts/check-recorded-audio-parity.py只读调用真实父端Python planner。
`meetingCloud.ts` 每段仅一次 recognizeInterval，原模型不变；v5 intervals 只包含已确认final，inFlight提交前落盘，final与正文保存成功后清除。旧成功证据保留，来源/模型不匹配失败关闭；旧unknown或残留inFlight在 generateRecording 与前台恢复入口都阻止重放和覆盖。旧sessionLimit字段仅保留历史，不驱动新提交。完整成功覆盖无需policy也不调用ASR。历史仅partial不是确认文字。
本项只改TS、测试和文档，未增加原生接口。离线结果与实际安装/22m提供方验收分开记录；零云调用、无卸载/清数据、未改根backend/server。详见 documents/dev_log/2026-10-16/2026-10-16_142000_wugui_无Issue_录音服务预算自适应分段/index.md。

## 2026-10-16 App 默认全文总结（最新总结合同）

`meetingSummary.summarize`（`meetingCloud` re-export）接收已保存的完整ASR与speaker组合证据，全文一次draft，再把完整原证据与draft交给同一显式传入模型做整体audit。不按字符数、segments、ASR预算或模型名称自动提取/合并事实；不写死任何模型context上限，不截断原资料。`splitTranscript/splitMeetingEvidence`仅保留兼容工具，不在默认生成链路调用。summary lib不使用自动retry；服务context/权限/transport异常原样传播，失败保留原资料与已确认checkpoint，不自动分段、换模型或重放。

SummaryCheckpoint v11仅以相同model/title/source复用完整draft/audit；v8-v10旧记录对象不修改，不把旧facts/merge或分段草稿当成全文结果。summary模型变更必须由调用者显式确认并冻结到独立summary操作，不修改原ASR snapshot/owner/来源；已有完整ASR+speaker只读复用，不能借总结失败重跑。恢复入口、未知操作阻止自动提交与新summary记录的持久边界由recording recovery负责；本次未改该层/UI。原有身份guard、顺序保存、失败不保存未审核正文继续生效。

源码/离线证据：documents/dev_log/2026-10-16/2026-10-16_174109_wugui_无Issue_App全文总结/index.md。无需新native构建；69条离线测试不代表手机/付费LLM验收。父端负责后续reload和实际调用，本代理未操作设备或云端。
