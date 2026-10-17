# App 默认全文总结与整体核对

## 父任务实际手机验收（2026-10-16 18:03–18:08）

- 用户已明确允许操作手机及重新加载。USB连接真实 HONOR TNA-AN00 Android14，普通debug App通过Metro加载当前源码；未卸载、未清数据、未构建新原生包。
- Metro旧进程无响应，重启为单worker、768MiB Node heap；旧文件映射缓存无法反序列化，重建后服务正常。一次reload后白屏，经仅重启App进程恢复，设备原资料均保留。桌面3100/API8900持续运行，Metro8081恢复运行。
- 选用已有约22m57s录音资料：ASR确认单区间0–1376.5485625s、speaker同源同duration、12/12分析窗口、clusteringVersion2。仅总结确认面板核验成功，明确选择deepseek-v4.1-flash，未修改语音/默认模型。
- 实际一次全文draft、一次整体audit成功，v11检查点分别保存1730/2289字符。新纪要版本2已保存，generation清空、无error。原transcript、transcriptionCheckpoint、speakerCheckpoint三个SHA256与生成前完全一致。没有重跑ASR或speaker，没有飞书交付。
- 真实手机点击版本2重新打开，正文、逐字稿/对话页签与编辑/导出/分享入口可见；版本历史实际列出版本1、版本2，旧版本保留。
- 发现并修正公开providerModel恰好等于id时被隐藏成“总结模型1”的显示问题；仅总结按钮前置。修正自动标题重复日期，并通过App修改名称入口纠正本次v2名称，正文未改。模型显示3suite19tests、按钮位置3suite17tests、标题2suite47tests通过。
- 后续源码小修：完整覆盖文案、summary阶段/字符数、保存元数据失败后查已有纪要而不重LLM，5suite94tests与tsc通过；这些失败分支属于离线证据，未制造真实网络/磁盘故障重复消耗额度。
- 脱敏哈希与确认回执保存在父仓库data/asr-release-20261016/app-summary-before.json、app-deepseek-full-summary-receipt.json；实际手机截图为app-deepseek-v2-reopened.jpg、app-deepseek-v1-v2-history.jpg。不将私密正文或设备缓存提交Git。本轮不是新ASR调用验收，也不代表iOS验收。

- 创建：2026-10-16 17:41:09 Asia/Shanghai；作者 wugui，参与 Codex；无Issue；模块本地实施/离线验证完成，未提交/安装/云验收。
- 已读 App AGENTS/dev_log README/template，检索现有摘要/服务预算历史并对照当前代码。App无.codegraph。
- 用户授权只改summary lib、对应tests及AGENTS/docs；不改UI/recording recovery、原ASR snapshot、根backend/server；无设备/云调用授权。
- 当前meetingSummary >8000字自动facts/merge，summary还用retry；meetingCloud只re-export summary，ASR无需修改。新策略全文draft+整体audit，checkpoint升v11避免复用旧事实提取稿；split工具仅保兼容，不驱动默认生成。
- 模型只使用显式传入summary model；DeepSeek实际ID由用户提供，不作为策略分支。独立summary新模型的授权/冻结与恢复入口由父端负责，ASR/speaker证据只读复用。
- 边界交接：generateRecording可能把summary TransportError标pending，已明确告知父端，未擅改恢复层。summary库取消自动重试；旧成功/失败checkpoint对象不修改。
- 验收：长全文/完整speaker证据两次调用、draft/audit分别保存、v11精确source/model/title缓存、旧v10不混用、context/transport失败不降级/重放、无ASR/speaker调用；低内存Jest单worker与tsc。

## TDD/验证

- Red：先新增 `meetingSummary.full.test.ts` 5例，实际5 failed；暴露长资料走facts、source未全量、并行facts失败不止一次调用、transport自动3次重试。没有用实际录音/云模型作测试。
- 实现：`src/lib/meetingSummary.ts` 改为全文draft+原全文audit；去掉retry/mapConcurrent与facts/merge调用，checkpoint升v11，保留导出的split兼容工具。`meetingCloud.ts`不需修改，继续re-export。未修改prompt内容、chatCompletion/API、ASR/speaker或recording recovery。
- 测试：更新 `meetingSummary.test.ts`、`meetingCloud.test.ts` 旧自动分段断言；新增full测试共9例（含DeepSeek和opaque模型同策略、完整speaker证据、context/transport/503不重试、model/title/source不匹配不复用）。旧prompt checkpoint对象原样保留，v11成功draft/audit精确复用。
- 最终命令：`NODE_OPTIONS=--max-old-space-size=512 node node_modules/jest/bin/jest.js __tests__/meetingSummary.test.ts __tests__/meetingCloud.test.ts __tests__/meetingSummary.full.test.ts __tests__/generateRecording.test.ts __tests__/meetingSpeakers.test.ts __tests__/recordedAudioTranscription.test.ts --runInBand --silent`。
- 实际 **6 suites / 69 tests passed，3.727秒**，单worker；目标tracked diff whitespace检查exit0。真实meetingEvidence与summary lib经过测试，chat stub；recognizeInterval和speaker inference未调用，原ASR模型/完整证据对象不变。
- 全量 `NODE_OPTIONS=--max-old-space-size=512 node node_modules/typescript/bin/tsc --noEmit`：第一次受父端恢复模块尚未就绪的2个TS错误阻塞；其模块落盘后复跑 **exit0，6.228秒**。没有为通过tsc改父端文件。
- AGENTS/README更新全文默认、v11、split仅兼容及无自动retry说明。运行源码已通知父端冻结，后续只编辑tests/docs；无设备操作、云调用、native构建/安装或根backend改动。

## Tesla/恢复层对齐事实

- v11 **没有** attempt/inFlight marker，只持久化已成功返回的draft/audit；不要依赖不存在的marker保证unknown只查询。库内retry已删除；再次显式调用时，没有确认稿的阶段仍会发生LLM推理，不能称为只读查询。
- 已把该事实和无自动retry边界告知父端；只读看到Tesla最新generateRecordingSummary注释已改为“保留confirmed parts，后续执行需显式确认”，不再声称summarylib拥有marker。本环境没有可寻址Tesla子代理消息工具/线程，因此以本共享工作区记录和父端交接同步，没有伪称直接发送。
- 已保存note/version的恢复必须由调用者先读取精确noteId/version并核对关联，直接复用，不应再次进入推理。本次没有改该层，不能用summary模块测试冒称其恢复验收通过。
- 无需为本轮引入复杂新API或marker迁移；若后续另行授权持久化unknown marker，应先补dispatch前落盘失败零调用、unknown恢复零调用的最小反例。本轮源码保持冻结，不在真实付费验收前新增该变更。
