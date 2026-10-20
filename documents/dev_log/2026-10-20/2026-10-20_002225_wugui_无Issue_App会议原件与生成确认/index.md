# App 会议原件与生成确认

- 创建时间：2026-10-20 00:22 Asia/Shanghai；建档作者：wugui；参与者：Codex。
- 分支：codex/app-meeting-ux-20261020；基线：origin/main f57c436。
- 状态：源码与离线验证完成，待独立审查/原生编译/真机验收；本地修改，未提交、未合入、未发布。

## 目标与边界

调查并修复原视频导出保存位置/反馈、完整视频预览及 seek、生成前明确模型确认和启动反馈。只使用 App 已有账号/本机原件与固定模型 Origin；不套用桌面 API，不恢复同步。

原 runtime checkout/Metro 保持不变；禁止付费 ASR/LLM、手机操作、发布、merge 和 commit。Jest 单 worker、Node 内存上限 384 MiB，独立缓存；不整体载入媒体。新增原生功能只能由后续重建安装包验收，不能宣称 HMR 已更新。

## 调查

- 文件导出当前 Share.open，未区分取消/完成；Android 缺少保存位置选择。
- App 无视频画面播放器入口；现有 Sound 播放不等于视频预览。
- 新 note intake 直接提交，prepareClientNote 在提交时读取当前全局模型，缺明确确认。
- 录音 summary-only 已有完整区间/说话人核验与独立 LLM 确认，保持该合同及未知不重放。

## 验收

- 导出保留原始字节、用户选目的地，取消不报成功，失败可见；owner/epoch 切换不能复用旧确认。
- 原生本机视频预览可 seek，关闭/后台释放播放器，不转换为 JS/base64，不请求网络媒体。
- 新生成先展示本次模型，确认后传递冻结选择；取消零推理，旧 unknown 只查询。
- 聚焦源码测试与 TypeScript；签名/原生包和真机状态另行记录。

## 实际变更

- `originalMedia.ts` 只接受当前 owner 的 files/recordings 精确原件 URI，校验 size 与 identity epoch；Android 保存协议失败关闭。iOS 复用现有 Share 的 file URL 保存，不传 data URI；取消单独投影。
- Android 在既有 MeetingFiles 增加系统保存位置选择，后台 64 KiB 缓冲复制，核对原件 size/mtime；无新增存储权限。账号切换取消与打开串行到 UI 队列。目标失败清理按后续安全收紧记录执行：不删除无法独立证明创建归属的URI。
- `OriginalVideoActivity` 为非导出 Activity；VideoView/MediaController 直接读取完整本机路径，seek 与进度交原生。iOS AVPlayerViewController 同样直接本机 URL；关闭/后台停播释放，不支持格式提示导出。
- 文件详情新增完整视频播放，明确导出忙碌/保存成功/取消/失败。异步操作按 owner/identity/route 阻断迟到反馈。
- `IntakeGenerationConfirmation` 只确认本次模型，不保存默认选择；confirmed pair 传到实际 prepareClientNote，旧 pending 或 B站 prepared 模型不符则拒绝，unknown 合同不改。确认前无推理，启动和失败有反馈。

## TDD 与验证记录

- Red：先加原件导出/路径/owner/seek 测试和本次冻结模型反例；运行两组，originalMedia 模块不存在、旧 prepare 忽略明确选择导致模型反例失败，23 个既有用例通过。
- Green 首轮：2 suites / 27 tests passed。
- 入口回归首次发现旧 B站测试仍期待点击即提交，调整为先确认模型；新增组件计数测试按真实 host 节点修正，未把测试节点重复计数误报为产品错误。
- 核心回归：15 suites / 213 tests passed（复用 iOS Share 前），覆盖 FileLibrary、NoteIntake、原件、原模型冻结、录音生成、summary-only、localOnly 与 unknown。
- TypeScript 多轮 `node --require ./scripts/offline-network.cjs --max-old-space-size=384 node_modules/typescript/bin/tsc --noEmit` exit 0。
- 最终命令：`node --require ./scripts/offline-network.cjs --max-old-space-size=384 node_modules/jest/bin/jest.js --runInBand --cacheDirectory artifacts/jest-cache --runTestsByPath __tests__/originalMedia.test.ts __tests__/IntakeGenerationConfirmation.test.tsx __tests__/clientNotePipeline.test.ts __tests__/NoteIntakeScreen.test.tsx __tests__/NoteIntakeScreen.models.test.tsx __tests__/FileLibraryScreen.associations.test.tsx __tests__/FileLibraryScreen.deleteGuard.test.tsx __tests__/RecordingSummaryRecovery.test.tsx __tests__/recordingSummaryRecovery.test.ts __tests__/RecordingsScreen.generation.test.tsx __tests__/generateRecording.test.ts __tests__/noteIntake.test.ts __tests__/clientNoteDispatchBoundary.test.ts __tests__/localFiles.intake.test.ts __tests__/localOnlyLibrary.test.ts --silent`。
- iOS Share 复用补充后同组15 suites / 214 tests passed；随后补充保留 owner 路径段拒绝和 iOS 根目录 symlink 防逃逸，最终验证见下方追加。没有扩大读取权限。
- 全部 Jest 禁真实网络，单 worker，Node384；没有测量设备峰值内存。node_modules 为指向既有依赖的工作树私有 junction，未安装/改 runtime 依赖；缓存仅在本工作树 artifacts。初始缓存递归删除被自动审查拒绝，后完整移入 artifacts/initial-jest-cache，未删除。
- `git -c core.whitespace=cr-at-eol diff --check` 通过。未运行 Gradle/Xcode、Metro、手机、ASR/LLM 或发布构建。

## 版本/签名与交付

- GitHub 只读：公网 latest v0.1.4（2026-10-17），LAN v0.1.4-lan 为 prerelease（2026-10-19）。v0.1.5 release not found，远端 v0.1.5/v0.1.5-lan/0.1.5 tag 均无匹配，当前可作为下一版候选；正式发版前需再次防并发核对。
- 按用户最新要求，不修改版本/重包：package 0.1.4、Android code9、iOS build5 原样。Release 仍要求原发布签名，不回退 debug；未读取签名凭据、未签名新包；Windows 未核验 iOS 发布团队和签名能力。
- 当前未提交/推送/创建 PR/merge/发布。父代理协调后续真机、内容质量门槛与版本0.1.5；桌面0.3.4不在此写集。

## 真机待验（父代理协调）

1. 新原生包中从会议/笔记来源进入视频原件，播放至尾段、拖动前后 seek、暂停/返回/后台，不把格式错误当原件丢失。
2. SAF/iOS 文件保存器选择位置与取消，核对导出字节 hash 与原件相同，取消/空间不足不报保存完成。
3. 取消模型确认零推理；改默认模型后仍用本次选择；启动立刻反馈，失败只查询原回执，不重放未知。
4. summary-only 继续复用完整 ASR/speaker，原件/原转写 hash 不变，不换原 ASR 模型、不恢复同步。

## 历史

- 延续 [2026-10-17 App笔记模型来源修复](../../2026-10-17/2026-10-17_180000_wugui_无Issue_App笔记模型来源修复/index.md)：设备固定 Origin、操作先持久化、unknown 不重放；已补反向链接。
- 保持 2026-10-16 App默认全文总结与仅总结恢复；无新 summary API 或推理策略。

## 最终追加

2026-10-20｜wugui / Codex：最终15 suites / 215 tests passed，包含新增 iOS Share 复用、保留 owner 段拒绝；TypeScript 和 CRLF-aware diff 检查通过。原生源码未经 Gradle/Xcode 编译，未重建/签名/操作设备；不能将离线结果当作视频解码或系统保存真机验收。所有源变更保持未提交，等待父代理独立审查与后续验收。

## 后续原生与确认Sheet收口

- 用户授权只做必要原生编译，不改版本、不安装、不操作手机、不触碰Metro。SAF失败原先调用deleteDocument的分支移除，不能仅凭返回URI认定本次创建；改非截断`rw`，先确认statSize=0再写，非空/未知大小拒绝，失败提示可能留下不完整副本。复制逻辑提为OriginalCopy.java，无delete/rename能力。
- JVM离线：`javac -J-Xmx128m -d artifacts/native-copy-test android/app/src/main/java/com/vinoteapp/OriginalCopy.java scripts/native-tests/OriginalCopyTest.java`，再`java -Xmx64m -cp artifacts/native-copy-test com.vinoteapp.OriginalCopyTest artifacts/native-copy-test`，6项通过：完整字节、非空不覆盖、取消零写入、未知大小拒绝、短源失败、中断不删副本。
- Gradle尝试 `:app:compileDebugKotlin :app:compileDebugJavaWithJavac -PvinoteChannel=public --offline --no-daemon --max-workers=1 -Dorg.gradle.jvmargs="-Xmx384m -XX:MaxMetaspaceSize=256m" -Dorg.gradle.parallel=false -Pkotlin.compiler.execution.strategy=in-process -x prepareSpeakerModels`，未执行assemble/bundle/install。JBR21在Windows NIO Pipe/UnixDomainSockets抛Invalid argument: connect，无法建立loopback；IPv4、短socket临时目录、JDK17和禁instrumentation的进程内尝试仍未通过，均在项目编译前失败。不把环境失败记成源码失败或整包成功。
- 替代真实编译：`artifacts/check-native.ps1`（保留于此工作树忽略目录，参数为本机已装工具/缓存），Kotlin2.2.0、Android36 android.jar、React Native0.87.1 debug-api.jar及既有OkHttp/Okio；Javac128MiB/Kotlin256MiB单进程。MeetingFiles/OriginalMedia/OriginalVideoActivity及相关Bilibili源文件编译exit0，无替身类、网络或模型下载；不证明资源合并、APK签名或解码验收。
- Sheet新增“重新读取模型”，只GET、不改draft；owner/ABA清空旧选择，序号阻断迟到。同步外层提交异常释放确认锁但不自动再请求。新增单次确认后unknown只recover/query、提交次数恒1的真实screen反例。
- 本次收口15 suites / 218 tests passed；TypeScript exit0，CRLF-aware diff检查通过。原runtime仍干净codex/app-main-next，Metro和手机未操作，所有版本文件未改。仍未提交/推送/发布。
- VideoView onStop stopPlayback，onStart从完整本机路径恢复，onDestroy清当前引用；尾部seek仍依赖原件索引/设备解码，尤其无Cues WebM必须真机验证，不声称all formats。

## 2026-10-20 01:22 Asia/Shanghai｜wugui / Codex 提交前收口

- 父代理按用户既有功能分支/中文PR授权协调提交；前述“不提交”是子代理阶段边界，未构成用户禁止提交。
- 独立复核曾发现旧owner Intent迟到、executor shutdown返回、旧导出错误污染新选项三项风险；已修复可撤销预览ticket、拒绝执行捕获及file/owner/identity/route/selection epoch绑定，独立源码复核通过。Jest221项、TypeScript与实际SDK classpath手动编译通过，新增JVM生命周期反例通过。
- 显式Android DEBUG候选工作流不使用Secrets或生产签名，基于公开配置/公共debug签名构建并上传验收制品；不会在push/synchronize上自动反复构建。当前尚无本分支APK，未安装/真机/发布，不能宣称脱USB与WebM完整seek通过。
- 再次fetch确认origin/main为f57c4369cc555cfcc9085f7cc9cc85fc3986fa4f，分支基点一致。拟提交和推送后创建中文草稿PR到main，内容质量及原生实机门槛未满足前不merge、不修改父gitlink。所有旧内容/原件/ASR保留；本轮无推理调用。

### 候选CI首次反馈与追加修复

提交7bf9883已推送，中文草稿PR #13目标main。GitHub运行39293209761在编译前拒绝workflow：job级env不允许runner上下文，具体为GRADLE_USER_HOME中的runner.temp；并非Android源码/模型错误。改为该临时runner的github.workspace/.candidate-gradle，保留独立缓存目录，追加修复提交。普通离线CI独立运行；尚未宣称候选构建成功。静态YAML检查不覆盖GitHub上下文语义，此失败记录保留。

运行39293608691已进入真实runner，但SDK准备失败：setup-android的默认packages包含已不存在的`tools`，sdkmanager明确返回`Failed to find package 'tools'`。显式仅准备`platform-tools`，后续SDK/NDK/CMake仍按工程已选版本安装；关闭无关许可证全文日志。此前失败在源码编译前，未调用模型，未产生APK。

## 2026-10-20｜wugui / Codex：候选证据与当时会议范围澄清（后被下节覆写）

- 只读核实候选 CI 39293842504 成功，实际 head `0a78b5f66e51ca87da310f38874a8458bf00620e`；standalone arm64 DEBUG APK 已构建，内置 JS、speaker 字节、ABI、包名及签名有效性检查通过。它替代前文“未产生候选”的状态，不抹去两次历史失败；不是正式版发布或本代理真机验收。本代理未安装/操作手机、未调用 ASR/LLM。当前父代理负责实机检查，版本仍0.1.4/code9。
- 最新用户明确：App 支持音视频的声音会议处理即可，不需要分析录屏画面。目标链为声音 ASR＋speaker＋summary，视频原件播放/导出保留；不引入录屏采集、抽帧、OCR、视觉模型或桌面视频证据链，不恢复同步。
- 对照当前代码：`localFiles.ts:importLocalFile` 将会议音频转交 `recordingLibrary.ts:importRecording`；后者仅接纳 m4a/mp3/wav/aac/flac/ogg（文件库的 opus 识别不等于会议录音库已支持）。`generateRecording.ts` 并行运行声音 `transcribe`/`analyzeSpeakers`，保存后用 `meetingEvidence` 调用会议 `summarize`。视频会议导入不进入该分支，而是保存 LocalFile；目前视频详情没有会议声音生成入口，仍是用户范围内待补缺口。
- 已有底层能力：Android `MeetingAudioModule.toWav` 选择第一条 audio/* 音轨，以 MediaCodec 流式解码为16k/mono/PCM16 WAV；ASR 与 speaker 分支均调用此接口。`clientNotePipeline` 对笔记音视频已走 transcribe→笔记 LLM，但不包含 speaker，不能把它称作完整会议链。iOS `MeetingAudio.m` 使用 ExtAudioFile，不是显式视频音轨解码；不能将 Android 能力外推至全部 iOS 视频容器。
- 最小建议而非本轮实现：会议视频详情提供显式生成确认，冻结 owner/file ID/URI/hash/模型/操作，复用既有转换，持久保存派生声音 WAV 及其原视频来源关联后进入现有会议流水线。原视频不移动/覆盖，派生引用参与删除保护；不把 cache URI 当持久源，不通过改后缀冒充音频，不自动推理或重放 unknown。iOS 容器解码先验证，必要时有界 AVAssetReader 选择音轨；无音轨/不支持应失败保留原件，不返回空成功。
- 本次独占修改仅 `docs/original-media-ux.md`、`AGENTS.md` 和本档案；不改功能源码/测试/workflow，不额外推理、不提交。历史正文保留；新增能力需另做离线反例、完整构建和父代理实际设备验收，现有候选不能证明缺口已补齐。

## 2026-10-20｜wugui / Codex：最新用户覆写为 App 录音范围

- 用户再次明确视频保留/播放/导出、会议录屏/画面分析全部仅桌面；App会议只录音及分析录音。撤销上节“补视频→会议声音链”的建议，不将它保留为范围内缺口。Notes B站链接仍可保存音轨生成笔记，PDF/DOCX等文档不受影响。
- 实际源码撤回：删除本轮新增 OriginalVideoActivity/OriginalLifecycle 及 manifest 注册、JS preview/close API、文件库视频播放；iOS只撤AVKit/OriginalVideoController/AVPlayer与专用视频验证增量，原有音频导入和选择器安全检查保留。executor安全捕获迁入FileTaskDispatch，与视频生命周期解除耦合。
- 收紧新写入：Android选择器先核对扩展名/MIME，iOS先核对扩展名/UTType，JS导入再防御，拒绝新视频且不写账号保留副本。原生导出/JS导出只接受音频文档。旧视频元数据、关联和筛选仍可读；详情不展示播放/导出/生成，提示不支持且未删除。手动删除仍须原有owner/确认流程，无批量清理或假迁移。
- 新模型操作拒绝实际视频文件；历史已完成结果和unknown不被自动更改/重跑。B站M4A虽保留历史sourceType=video来源标签，按真实文件扩展名放行，既有笔记B站流程回归通过。录音summary-only完整ASR/speaker复用、模型确认/GET-only和OS导出反馈保持。
- TDD：新增视频导入及历史视频UI反例先失败（旧行为复制视频并显示播放/导出/生成），修复后通过。原15 suites/221项同组调整后15 suites/232项通过，TypeScript通过；JVM复制6项及真实executor shutdown/音频文档vs视频策略反例通过。Android变更真实SDK/API classpath手动编译通过；iOS未Xcode编译、未真机。仅源码/离线验证，不把旧0a78b5f候选当本次APK。
- 当前不触碰Hume workflow、不改版本/目标main、不安装/手机操作、不云端/ASR/LLM、不提交。提交前由父代理审查；历史正文保留以解释范围变更。

- 最终收口：移除可见视频筛选，旧video/screen筛选规范化为全部，历史视频仍可在全部找到；会议文案不再承诺录屏，历史视频详情仅提示“此视频仅保留历史记录，视频功能请使用桌面端。”，不出现“可导出/人工管理”。中间232项后新增旧筛选兼容反例并加入B站音轨回归，最终17 suites/244 tests通过（原15 suites最终233项＋B站2 suites/11项）。TypeScript、manifest解析和Android原生手动编译通过。git diff origin/main确认manifest净差异为零、既有音频解码/会议生成/summary-only未更改；无workflow/版本/签名配置修改。源码冻结交父代理审查，未提交。

### 主审追加：真实录音导出接通统一OS保存结果

- 主审发现真实`recordingLibrary.exportRecording`仍调用旧Share.open并返回void，`RecordingsScreen`只有正在导出phase，无保存/取消反馈。该缺口真实存在，不将此前LocalFile导出测试当作真实录音验收。
- TDD先验证5个service反例失败（void结果、未走Android exporter、ABA与迟到owner保护缺失），另3个Screen反例失败（无saved/cancelled反馈、切换录音后旧错误弹窗）。修复保留原录音id/目录/扩展名/file stat校验，加首await前identity epoch，调用真实共享exportOriginal传原URI/size/音频MIME，无整段readFile/base64。Android保持既有三参数原生协议；iOS复用同一Share保存选择器并传音频MIME。
- Screen保存/取消文案独立于phase；action finally清phase与working，reload不清掉本次有效结果。锁在实际action内生效，重复点击不再改phase或提交两次。录音详情epoch＋owner identity epoch＋id/URI绑定反馈，切走再回到同录音、账号ABA、卸载均丢弃迟到结果，旧详情错误也不污染新详情。
- 聚焦7 suites/52 tests通过；加入前述audio-only/模型确认/summary-only/B站回归后最终22 suites/276 tests通过，TypeScript及diff检查通过。最新改动只有TS/测试/文档，不需要额外原生接口。视频收缩与workflow/版本/签名配置保持；无云端/ASR/LLM、无设备操作、未提交，再次冻结交父代理审查。

### 真实设备导出P1：仅归一化可信Context根别名

- 主线程在已安装eace563上通过真实JDWP定位`OriginalMediaKt.originalMedia:16`：SOURCE_PATH_CANONICAL_EQUAL=false，REGULAR=true，BYTES=22266052。主线程报告源hash稳定、DocumentsUI可解析、MainActivity resumed；因此不是缺文件、大小或SAF支持问题。本代理未操作设备或重复JDWP。
- `OriginalPathPolicy.requireFile`只规范化可信`Context.filesDir`根。输入字面路径必须精确等于该根或其canonical根下的`files|recordings/accounts/<encoded owner>/<validated filename>`；实际canonical文件必须等于由规范根拼出的预期路径。预期后代路径绝不再canonicalize，避免把owner/file symlink“合法化”。文件类型/大小、URI限制、音频文档allowlist仍保留，读取使用规范后的同一原文件；不改原件、SAF、权限或模型。
- `OriginalPathPolicyTest`使用真实`Files.createSymbolicLink`，不mock、不跳过：复现旧三条件中仅路径相等失败，随后验证根别名/规范路径、文档和编码owner四个合法用例；13个拒绝反例含错误owner、traversal、非法owner段、越界、owner链接、文件内外链接、根下目录链接、非可信根别名、空/缺失/非文件。源字节未改。
- 单独Javac编译该helper/test后运行`java -Xmx64m -cp artifacts/native-path-classes com.vinoteapp.OriginalPathPolicyTest artifacts/native-path-classes`通过。更新后的Android源以真实Android36/RN0.87.1/Kotlin2.2.0 SDK classpath独立编译exit0；executor/类型门禁及复制6项JVM反例通过；recordingExport、RecordingsScreen.export、originalMedia共3 suites/27 tests通过，diff检查通过。没有编整包/安装/ASR/LLM/云调用；需父代理审查后CI候选与真机复验，未提交。A r2私有正文SHA仍为180fcb2dafb2042b3ef5dee31c0566e1066de499a31b93222bf6aa5f1bd97a55，未改。

- 提交前按主审要求将路径测试文件名替换为纯合成`meeting-001.m4a`，不携带真实录音标识或用户路径。JDWP三条件记录为：字面/规范路径相等=false、普通文件=true、大小有效=true；主线程同时核验源大小及SHA稳定，原件完整未变。设备证据由主线程取得，不归为本代理实测。
- 替换合成标识后重新验证：Windows真实Files symlink测试4合法/13拒绝通过且没有skip，executor/文件策略及复制6项通过；Android独立原生编译exit0；22 suites/276 tests与TypeScript重新通过。本机JBR21以`--release 17`编译纯Java边界，未声称本机运行时为JDK17。
- 原offline CI只有Node/TypeScript/Jest，未运行该JVM反例。按用户明确授权最小加入setup-java Temurin17及单个javac/java步骤，直接编译生产OriginalPathPolicy和真实symlink测试，无Android SDK、模型、Gradle、凭据或推理依赖，不skip链接。现有PR/push-main触发与权限保持；candidate workflow/版本/签名均未改。此处记录的是已接入源码，CI实际结果待父代理审查提交后验证；未自行触发CI或提交。

### 2026-10-20 09:33 Asia/Shanghai｜wugui / Codex 提交前复核

- 主线程实际复跑22 suites/276 tests，全部通过；TypeScript通过。独立只读审查未发现本写集未解决P1/P2，允许提交功能分支并重建候选，仍不等于实机验收或正式发布。
- 早上已验证并保留数据安装旧head0a78b5f的standalone DEBUG候选；它包含随后撤销的视频功能，不能用作最新范围的验收包。最新源码需重新构建。手机由offline恢复到unauthorized，正在等待用户于设备确认USB调试；没有清除数据或代操作授权。
- 桌面summary-only实际候选第一步返回无效JSON，未进入第二步；无ASR调用、无自动重试，未修改本App的总结模型或既有逐字稿。内容评分门槛仍未通过，本PR保持草稿，不合并、不发布、不更新父gitlink。

### 2026-10-20｜主线程提供的 f8f8662 真机导出与确认取消证据

- 本节为主线程实际设备操作及读回结果的记录，由本代理整理；本代理未操作手机、未自行安装/点击或独立测得下列设备结果。f8f8662 的 offline CI 与 native候选构建成功，主线程完成保数据安装；无 adb reverse，原录音SHA保持不变。历史09:33的设备/候选状态保留，不代表本节的最新状态。
- 22:57 主线程从真实录音详情点击导出，系统 Downloads 保存选择器正常打开；按Android返回后，App明确显示“已取消导出，原音频保留”。这是真实选择器取消回调验证，不是组件测试或分享面板打开推定。
- 再次导出并保存为 Downloads 中的新副本 `VINote-audio-export-f8f8662-20261020.m4a`；App显示“原音频已保存到所选位置”。主线程读取新副本为22,266,052 bytes，SHA-256 `efd8b91bbd3c939df9eb1b311502a288b7ff896272c66c353b0dec4964a2d599`，与私有原件完全一致；原件未变。这验证了本设备本次保存的字节完整性和扩展名保留，不外推所有DocumentsProvider/所有格式。
- 主线程实际打开生成确认Sheet，看到“仅生成纪要”、沿用设备原冻结的阿里paraformer及Deepseek，以及拟“生成版本3”；随后点击“暂不生成”。未换成Luna、未确认执行、未调用新的ASR/LLM，不记录为生成成功。取消后实际版本是否仍为2，当前待读回确认；不能将待核实状态写成已验证。
- 本次只追加实机证据，不改源码、模型偏好、版本、workflow或署名纪要，不提交。此前离线276项/native测试与本节设备操作证据分别成立，不互相替代，也不构成全产品/正式发布放行。
- 主线程随后实际读回确认：取消生成后仍为版本2；点击版本2正文重开正常。原音频显示总时长22:57，实际从0:00回听至0:25后暂停。由此关闭上项“版本2待读回”的待核实状态；未创建版本3、未换模型、未执行新生成。本代理仅记录主线程提供的结果，不宣称自行亲测，也不将25秒回听外推为全音频逐秒播放验收。
- journal补充完成后文件冻结，交主线程提交docs并推送；本代理不提交、不修改代码、不触发candidate构建。
