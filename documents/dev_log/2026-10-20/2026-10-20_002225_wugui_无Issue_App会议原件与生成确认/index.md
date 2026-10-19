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
