# 自适应流式转写与插件商店

- 建档作者：wugui（仓库配置）；参与者：Codex、Plato。
- 日期/时区：2026-10-13，Asia/Shanghai；状态：实现中，完整实机验收待完成。
- 交付：当前工作区修改；未提交、未发布。无 Issue。

用户要求取消会议可视化，录制仅保存音频，停止后 ASR 与说话人并行，再总结；任何已配置模型不按名称写死分段，不自动切换。飞书以插件安装/启用/授权分离。原录音保留，无内容同步。

实现：`asrStream.ts` VLA2 小帧传输、v5 来源/模型/区间检查点、同模型恢复；`generateRecording.ts` 长短录音都并行分析；原生 WAV 流式转换复用，音频不整份进 JS 内存。最终结果与关闭竞态修正；未发完整不能保存，帧读取长度核对。插件商店使用账号隔离的设备安装状态，停用不撤销授权或删除历史发布；移除图示新运行入口。

验证：相关44项回归与流式协议4项通过，App TS通过；真实公网阿里云桌面适配120/340秒最终识别成功，340秒1454字。并非手机完整录音成功。手机仍需实际操作长录音/后台/重试，飞书联系人及LLM转换尚未完成；不把安装成功当作授权/交付成功。

证据和后续计划见根仓库 `docs/plans/2026-10-13-adaptive-asr.md`、`docs/reviews/2026-10-12-actual-ui-verification.md`。新检查点缓存与源文件隔离，失败保留已确认区间；不要恢复旧12秒/60秒模型策略。

独立审查追加：旧transcript非空不是完整转写证明，生成前总由检查点层核对源文件与覆盖；列表/详情pending可显式继续，原模型和版本保留，不自动重放；读取音频后校验账号epoch。流式与生成/恢复入口21项、TS通过。火山公网120秒后续成功。完整流水线测试启动被自动审批拦截，未运行，不能声明手机完整生成已成功。


2026-10-14 08:33 追加（未提交，实机验收仍进行中）：采用导航任务存活/账号 epoch 隔离、提交与确认进度分离、取消图示新运行和历史重试入口、文件删除确认替换 Sheet 与取消焦点恢复、公开目录模型名称、飞书临时服务故障保持授权与回执、ASR 第一错误来源数值诊断。最后诊断改动根 App 8 suites/176 tests 和 TypeScript 通过；不能据此声明长录音通过。78分10秒阿里云在音频结束前失败，原录音与说话人证据保留；22分57秒豆包实机任务于08:05开始，08:32提交86%，仍等待最终结果，无中途热更新。详细事实与各测试区别见根 docs/reviews/2026-10-14-four-recording-asr-matrix.md。既有正文同步取消，原录音未清除。


2026-10-14 08:48：22分57秒豆包完整发送后服务端 unknown_result，原录音/说话人12段保留，无纪要生成。新增首因诊断实机给出 server_error、sentComplete=1、nativeReader=1、6883帧；未将发完当作转写成功。任务结束后采用样本时钟 pacing，读取/桥接耗时计入帧预算，暂停后不突发补发；反例旧实现失败、新实现根8 suites177 tests和TS通过。Metro未停，未修改模型/等待上限/身份/最终结果守卫。该修正不等于服务端最终结果问题已解决。


2026-10-14 09:02：采用录音详情纯展示调整。失败结果/下一步仅一次，unknown保持不自动重发；确认转写0与说话人12/12保留，详情仅模型。根App32状态/进度+14导航/生成=46测试、TS通过；实机展开检查通过，截图位于根data/device-validation-20261014/phone-recording-product-copy-0902.png。未重试音频或改模型，长转写仍未验收通过。

### 2026-10-14 09:34 联合验收继续

用户恢复控制，群通知不实发，只检查链路。三份飞书候选8文件经归一LF基线/候选哈希采用：后端95、Desktop35、App57回归通过，两端TS通过。App暂时不可核验时不确认发布对象、不启用失败对象重试。未发群消息，未新增权限，公网后端修复尚未部署。桌面/API/Metro运行、USB8081保留。长录音仍未完成验收；服务器诊断v2在严格基线校验停止，已定位raw/LF哈希混用，独立v3待验证，生产ASR未变。

### 2026-10-15｜wugui / Codex｜明确 ASR 错误与 reader 清理的离线复现

用户限定：不发起 provider 调用、不重放、不操作手机；本机 speaker 仍运行，不改生产模块或 native/pacer。仅追加 `__tests__/asrStream.test.ts` 三条离线 characterization 和本档案，未提交、未刷新或安装。

确认的代码行为：`asrStream.finish` 收到明确错误后立即标记 done、关闭 WS、启动 reader.close，但等待 close 完成才 reject。close 挂起时，生成层 ASR catch 无法报告失败；这证明一个可复现的延迟路径，不证明本轮手机实际卡在 close。生成层最终错误落盘另外等待 speaker 的 allSettled。当前 UI 文本解析优先识别“失败”，没有证实解析错误。

本次不实施简单提前 reject：生成层持有 slot/recording lock，finally 在两路结束后释放；如果仅提前 reject，speaker 完成时旧 reader 可能仍未释放，新作业便可能进入。限于只修改 asrStream 的范围，不能完整维持生成资源 guard。按用户明确授权采用仅复现的兜底方案。

后续最小安全设计（本次未应用）：保留原 ASR promise 作为 cleanup 完成屏障；增加独立、幂等的 terminal-failure 通知供生成层立即更新失败 UI；生成层仍等待清理屏障及 speaker 落盘后才结束。done/身份检查继续阻止晚到 read 和 WS 事件发送。成功始终等待 close 成功及身份确认；close 失败与明确业务失败分开记录，清理未确认时必须保留资源阻塞，不能假定释放成功。若要求 ASR 主 promise 立即 reject，则需显式传递并由生成层等待 cleanup handle，涉及 generateRecording/资源 guard，超出本次范围；单独加超时或模块内 busy 标志不足以保护整个生成锁。上述方案需要后续授权且待 speaker 完成才应用。

离线验证（真实函数 + mock WebSocket/native，没有网络）：

- `node node_modules/jest/bin/jest.js __tests__/asrStream.test.ts --runInBand --watch=false -t "cleanup barrier reproduction"`：3 passed。两种 close 结局（resolve/reject）均证明错误先阻塞 10 秒模拟时间、WS 已关、晚到 read/started/open 不发送新帧、retry 仅调用一次、cleanup rejection 被处理且保留原 asr_stream_failed；成功 final 必须等待 close 确认。测试通过表示复现现有缺陷和守卫，不表示已修复及时失败显示。
- `node node_modules/jest/bin/jest.js __tests__/generateRecording.test.ts --runInBand --watch=false -t "long ASR failure|safe ASR category|a failed task becomes paused"`：既有3 passed。验证 ASR 失败保留 speaker checkpoint、不调用 summarize，以及 paused 记录不被恢复函数重放。这些入口均为 mock，不是真机通过证据。

未完成：本轮设备根因绑定、及时失败显示的产品修复、cleanup 未确认后的资源恢复策略。未做 native/background/pacer 改造，也未将屏幕睡眠当作本轮原因。

### 2026-10-15 17:25 后｜wugui / Codex｜终态失败独立通知，保留 cleanup 屏障

用户确认17:25:24手机任务已结束后，授权直接修改两个运行模块及对应离线测试。`asrStream.recognizeInterval` 增加末尾可选 onFailure 回调；finish 先 done、关闭WS并启动close/注册成功失败处理，再同步通知错误。Promise仍等待close，成功仍需清理及身份确认；没有提前reject或改变生成锁生命周期。会话限额不通知失败；取消及scope失效由assertCurrent阻止通知；回调异常被捕获，不打断cleanup。`meetingCloud` 仅转发静态失败progress，并再次校验来源scope，不保存正文或跨账号状态。

对应测试更新：明确错误＋close挂起时通知立即发生、Promise仍pending；通知抛错不影响close，close失败保留首因；晚到帧/事件不再发送；限额/取消/身份变更/撤销不通知；成功仍等close。真实transcribe与mock socket/native集成分别验证server_error及socket_error即时进度、无重试或新确认区间。未改generateRecording/native/pacer/模型/恢复策略，也未读写设备checkpoint。

验证：`node node_modules/jest/bin/jest.js __tests__/asrStream.test.ts __tests__/asrReplaySafety.test.ts __tests__/generateRecording.test.ts --runInBand --watch=false`：3 suites / 59 passed。`node node_modules/typescript/bin/tsc --noEmit`：exit0。纯离线，未调用云端、未点击重试、未构建安装；未提交。

用户提供的实际最终metadata：paused、unknown_result、category1/stage2、audioAttempted1、sentComplete0、origin socket_error、readerMode1，submittedBytes/nativeReadBytes38105600、submittedFrames/nativeReadCount5954（1190.8秒）；speakerTurns519/checkpoint v1、ASR intervals0、savedNote false。据此确认native reader实际生效；221.8秒服务session没有绑定证据，不能归为该手机本轮根因，也不能声称卡read220。此次修复仅处理通用错误通知延迟，不证明已修复socket传输根因或完成长录音验收。cleanup永久挂起仍保持pending与资源锁，需后续独立调查，不伪造关闭确认。

2026-10-15追加：完整22分57秒零额度transport回归已加入asrStream.test.ts，真实recognizeInterval/fakeTimers、冻结Aliyun模型，精确44,049,554 PCM字节、6883帧（末帧4754字节），单socket/单start/单LAST，序列与每帧长度全量核对；最后一帧前不完成，发送完成/partial仍不完成，仅模拟final后成功。不硬编码分段。计数socket不保留payload，FS.read使用普通函数避免Jest结果记录保留base64。20秒subprocess硬上限，最终测试2512ms、进程4.474s，1 passed；filter为full 22m57s transport。未改生产源、未运行手机或云端，不构成真实provider长录音验收。

### 2026-10-15 18:12 +08:00｜wugui / Codex｜专属Android ASR transport（待主review，未安装）

用户授权修复确定缺陷：RN忽略OkHttp.send false、底层异常message在error事件首因锁定前丢失。采用专属VINoteASRTransport薄bridge＋纯Kotlin ASRSocketCore/ASRTransportPolicy＋JS adapter；不patch node_modules，不改其他WS、provider协议、native reader/pacer、模型或资料。APK新增VINOTE_ASR_ORIGIN字段，来源deployment.apiBaseUrl；校验Origin/path且不接收URL凭据/查询参数。token只在内存握手使用，不写日志。旧Android包不具protocol1能力时阻止新ASR，不回退旧传输；iOS保持既有路径。

native true ACK才计提交；64KiB真实queueSize背压，等待最多10秒，send false终止且不重发。错误仅数字0..10白名单，首因保留；无网络自动重试或模型变化。关闭redirect和SSL redirect、connection retry，pingInterval明确为0（撤回曾建议的20秒ping，避免EOF后server不poll时假失败）。binary在decode前限制8560字符，start在JSON/UTF8前4096字符；上游单条与排队文本总量限制8MiB UTF8。frame coverage已改little-endian；此前big-endian为主review发现的阻断，不能把初版手写自洽测试当协议证据。

review推动的真实竞态修复：final可以在LAST的同次native ACK进行中暂存，原deadline仍生效；true ACK后重新核身份才可接受，false/身份变化/IOerror/deadline不接受。正常peerClosing只传安全code、不伪造EOF；真实adapter不会因此锁定firstFailure，ACK不会被后续正常关闭抹掉。真实本机WS发现cancel-only在已收到close帧后可能没有终止回调、资源屏障挂起，现正常peer关闭回复close握手并等待onClosed/onFailure，主动取消仍cancel；关闭/失效状态及safePost/safeSchedule禁止晚回调复活或RejectedExecutionException逃逸。reader和socket通过allSettled同时等待后才结束生成Promise，未提前释放slot。

验证材料：新增android/asr-transport-tests/README.md、真实JS pcmFrame fixture生成脚本、离线Kotlin编译/JVM网络测试runner。使用缓存真实RN0.87.1/OkHttp4.9.2/Android36 APIs编译实际模块；BuildConfig只有编译shim，未构建APK。生产core真实OkHttp连接loopback stub，覆盖慢读造成实际queue积压/背压、真实send=false、断开、post-LAST延迟final+正常close、cancel晚回调、302不follow及错Origin拒绝；peer核验只有6个计划连接、6402PCM/2frames/1LAST，synthetic token唯一允许，无provider调用。完整44,049,554字节/6883帧policy交叉消费实际JS首两帧/末帧fixture，另保留真实JS长发送fakeTimers回归。具体最后结果由随后追加记录核实，不将mock JNI当真机通过。

Android Gradle受限编译启动失败：--offline --no-daemon --max-workers=1、Gradle堆768MiB/Metaspace384MiB/Kotlin in-process，JDK17 PipeImpl→UnixDomainSockets.connect报Invalid argument，未进入项目编译。IPv4和WindowsSelectorProvider的进程级尝试亦未解除；未改系统/JDK配置、未停Metro/API/Tauri、未安装/重启/清资料/点击重试。纯Kotlin真实API编译与本机TCP WS检查通过不能替代APK构建/主review或手机验收。待主review与构建环境修复，不宣称上一轮1190.8秒socket_error根因已经修复。

2026-10-15最终复验追加：正常peerClose握手修复后，python scripts/check-asr-native-offline.py --local-ws exit0，实际生产core/真实OkHttp六场景全部通过，peer核对6连接/6402PCM/2frames/1LAST；本次约7秒。JS六suite120 tests通过，App typecheck exit0。源码待主review；APK仍未构建、未安装。不得用这些离线与loopback证据替代原生真机/真实provider验收。

2026-10-15主review收尾追加：bridge字段写入集中为薄bridge实际调用的writeASREventFields，并由JVM直接执行契约测试（peerClosing只输出code1000..4999，error只输出category0..10，非法值各自归一化且不输出reason）。真实JS adapter新增pending true ACK＋peerClosing.code1000契约回归，后续close不抹掉ACK，关闭后禁止新enqueue。core所有ASRSocketResult观察者均隔离异常，pending/active/closers先清状态；真实OkHttp测试注入throwing connect/start/failure/pending/close观察者，验证取消后同一core可再次连接。loopback扩展8计划连接通过；扩展测试曾发现stub302缺Connection:close导致后续复用已关闭连接，已修stub HTTP声明，不修改生产no-retry策略。最新两suite48项通过，typecheck exit0；native真实API编译、bridge字段与core网络8场景通过。未重跑Gradle、未安装。此前捕获的完整Gradle栈转存为本目录gradle-jdk17-loopback-stacktrace.log，标注原exec chunk3c5ea7来源，不伪称本次重新运行。

### 2026-10-15 Gradle loopback恢复与低内存APK构建
用户授权仅构建、不安装。默认TEMP为8.3形式ADMINI~1；同一机器上JDK17和已有JBR21的Selector/Pipe独立探针均在默认目录失败，仅指定jdk.net.unixdomain.tmpdir到D:/projects/VINote/data/jdk-pipe后均通过（原始探针输出jdk-loopback-probe.log）。这是临时pipe路径问题的直接复现，不能据此归因ASR网络/代理。补充实际工具链：launcher的JAVA_HOME是JDK17，项目gradle/gradle-daemon-jvm.properties固定toolchainVersion21，daemon实际使用已有Gradle cache内Adoptium21，无下载。
仅把-D参数放JAVA_OPTS或org.gradle.jvmargs不足以在daemon创建Selector前生效，daemon日志证实未携带该启动属性。现通过仅构建进程的JAVA_TOOL_OPTIONS=-Djdk.net.unixdomain.tmpdir=D:/projects/VINote/data/jdk-pipe传给所有子JVM，loopback已解除；未改系统/JDK/Gradle配置。首次实际构建又暴露PowerShell未引用-Pkotlin.compiler.execution.strategy=in-process被拆成任务名，保留gradle-apk-build-02.log失败记录；修正为完整引号参数后启动gradle-apk-build-03.log。
本轮命令为assembleDebug --offline --no-daemon --max-workers=1，Gradle512MiB heap/256MiB metaspace，Kotlin in-process，public channel，arm64-v8a；JAVA_OPTS仅64MiB launcher，CMAKE_BUILD_PARALLEL_LEVEL=1。跳过可能触发模型下载的prepareSpeakerModels，现有segmentation/embedding两模型逐文件SHA256均与准备脚本manifest一致。启动前无Gradle/Kotlin/ASR测试JVM残留；构建中仅一个Gradle JVM，驻留约600MiB，未启动Kotlin daemon，未停止Metro/API/Tauri。13项ASR/runtime-source输入hash保存在apk-source-manifest.json；不是全仓snapshot，也不包含凭据或录音。完成状态与APK摘要待实际构建结束追加，不提前记成功。

### 2026-10-15 18:31 APK构建实际完成（未安装）
assembleDebug成功：BUILD SUCCESSFUL in 2m 12s，235 tasks / 25 executed / 210 up-to-date，exit0；包括实际app compileDebugKotlin/Java、DEX、ARM64 native libraries与packageDebug。APK：android/app/build/outputs/apk/debug/app-debug.apk，136752884 bytes，SHA256=6451fb44b1330e9ee12f438986e0c5ee510d79b4610ac47b4470a135f0e79487。包名com.vinoteapp.dev / versionCode9 / versionName0.2.0 / arm64-v8a；普通debug依赖现有Metro，没有内置JS bundle。APK DEX确认VINoteASRTransport/ASRSocketCore/ASRTransportPolicy/writeASREventFields存在；13项记录的ASR/runtime源输入构建前后hash完全一致（非全仓快照）。apksigner verify exit0/v2有效，日志apk-signature-verification.log；构建回执apk-build-receipt.json与原始gradle-apk-build-03.log/exit保留。单次Gradle进程已退出后才以96MiB JVM串行验签；未停止其他服务、未安装、未卸载、未清数据、未运行手机ASR或provider。原有KSP/AGP弃用warning未更改依赖；256MiB metaspace告警未导致本轮失败。

仅当前构建进程设置的可复用命令（PowerShell，cwd为VINote-app/android；dotted -P参数必须整段引用）：
```powershell
$env:JAVA_TOOL_OPTIONS='-Djdk.net.unixdomain.tmpdir=D:/projects/VINote/data/jdk-pipe'
$env:JAVA_OPTS='-Xmx64m'
$env:CMAKE_BUILD_PARALLEL_LEVEL='1'
.\gradlew.bat :app:assembleDebug --offline --no-daemon --max-workers=1 '-Dorg.gradle.jvmargs=-Xmx512m -XX:MaxMetaspaceSize=256m -Dfile.encoding=UTF-8' '-Pkotlin.compiler.execution.strategy=in-process' -PvinoteChannel=public -PreactNativeArchitectures=arm64-v8a -x prepareSpeakerModels --stacktrace
```
pipe目录先已创建，缓存模型hash先已核验；不修改系统环境或项目JDK标准。两个失败构建日志、默认/短pipe探针对照均保留。这个构建结果不等于真实长录音/provider验收，安装仍交主代理控制。


### 2026-10-15 18:47 +08:00｜主线程实机回执：APK安装与Native桥接拒绝路径通过

主线程已实际adb install -r Success（保留资料），APK SHA256与构建回执6451fb44b1330e9ee12f438986e0c5ee510d79b4610ac47b4470a135f0e79487一致；18:39启动App，Metro成功bundle，会议页/文件库可用。旧paused记录、519 speaker证据和原录音保持不变。此前构建回执installed=false是构建时点事实；本条追加后续真实安装状态，不改写历史。

主线程通过8081 DEV inspector json/list精确匹配appId，在实际Hermes runtime评估临时DEV探针；没有改页面脚本、index源码或产品入口，没有提供方URL或真实凭据。Hermes awaitPromise直接返回{}，主线程使用唯一临时DEV global短轮询取得结果后delete；未保留持久调试对象。这里区分执行者：设备操作由主线程执行，本次仅只读核验已保存JSON并更新档案。

实际结果：protocolVersion=1；connect/enqueue/close三方法存在；origin-rejected、fractional-pcm-rejected、base64-predecode-bound、text-preparse-bound各返回ASR_TRANSPORT_10，no-session-after-close返回ASR_TRANSPORT_1；五项全部pass，cleanup=true，总pass=true。当前APK安装、native模块实际加载、设备上的bridge参数/Origin拒绝和无会话幂等清理路径已有实机证据。该探针不包含成功连接/传输、前后台长音频或provider最终回执验收。

证据：app-native-rejection-probe.json（本机验收材料已排除，未随源码交付），477 bytes，SHA256 `7896e154fa09bd995158fc421bc8fc5089c2c409bd2384785ec20333b411afbb`。本条仅追加日志，未重复构建/安装，未调用云端或重放生成。

### 2026-10-15｜ASR上传与收尾期限分离（TS源码与离线验证）

已确认旧整个session的1.5D+90秒timer会被约D秒实时发送消耗，剩余0.5D+90不足以覆盖当前豆包服务端默认D+12的EOF预算。仅修改src/lib/asrStream.ts：初始timer继续限制准备/发送及LAST入队ACK等待；同一次LAST enqueue成功、scope核验通过、sentComplete=true且尚未done后，一次性重设1.5D+90秒收尾timer。partial与重复started不续期；提前final仍须等待同次LAST true ACK；原deadline超时后的迟到ACK不得复活或重设timer。保留unknown结果、不自动重放、即时失败通知与等待reader/socket cleanup的Promise边界。ACK仍仅代表OkHttp入队，不代表provider确认。

新增__tests__/asrStream.test.ts三条fake-clock回归，使用真实recognizeInterval与Android transport adapter：迟到LAST ACK后可超过原整个deadline合法接收final；收尾无final最终到期且末刻partial不延长；buffered final加未确认LAST仍受原deadline限制、迟到ACK不续期。计数验证timer仅初始与收尾各一次、单连接、仅start与LAST两次enqueue、无重放、清理一次。串行离线Jest三套asrStream/asrReplaySafety/generateRecording共72 tests通过（报告运行14.516秒），node512MiB tsc --noEmit exit0。

未调用云端、未操作手机或重放任务、未构建或安装APK、未修改native/pacer/模型/桌面Python。此次TS修改是既有APK构建源hash清单之后的新源码，不能再声称历史13项manifest与当前TS全部一致。未新增服务端显式预算协商；本收尾上界覆盖当前默认D+12，不保证管理员特殊超长override，也不据此认定旧手机断流根因已修复。

### 2026-10-15｜22m57s实机ASR成功后摘要暂停：同身份并发refresh竞态

只读ADB run-as读取限定record 1792052063450-tqgk6b9acq的安全字段：generation.status=paused，error精确为“账号或服务已切换，原操作已停止；本机稿仍保留”（SessionScopeChangedError），errorDetails.code/status无值。transcript长度6469，v5 interval 0–1376.5485625/text长度6445；当前summaryCheckpoint实际保存键为facts:1，不能误记facts:0。用户提供真实session514f468a-2f9b-46a7-96a4-034368fc2a32及19:48:35 server final回执；此前speaker已保存。没有输出正文、鉴权或凭据。该错误不是SessionGateError“账号尚未核验”；设备未保留调用栈/refresh trace，不能声称已直接证明当次触发栈。

源码确定缺陷：facts mapConcurrent=2；各apiTextStream创建独立remoteRequest.context；supabase.accessToken原来因refreshing.context不同并发刷新同一身份refresh token，先完成者更新sessionRevision，后完成者因revision不等抛SessionScopeChangedError。新增离线回归在修复前实际失败：预期1次refresh却得到2次。最小生产补丁仅src/lib/supabase.ts：串行化refresh事务，每个等待者保留自己的guard/context；排队后重新读凭据，原identity epoch/owner/origin guard成立且revision已由前序刷新更新时使用当前token，不重复轮换。真实取消、A→B→A、旧lease、返回owner不匹配仍拒绝，不改sessionGate、MCP/飞书权限、摘要提示词或checkpoint版本，也不新增恢复调度。

离线验证：sessionGate/apiAccount/auth/storageRace/meetingCloudAliyun五套105 tests通过；新增不同context并发401的真实apiTextStream路径，只一次refresh/一次凭据保存，两个请求各一次401后的授权发送；排队调用取消和A→B→A均不能接受旧响应。meetingCloudAliyun既有三条断言补齐此前recognizeInterval已增加的signal/onFailure参数，无业务改动。新增真实transcribe()完整1376.5485625秒v5区间、同fingerprint/duration/model返回缓存，recognizeInterval零调用。meetingSummary仅定向运行新增explicit recovery两条（含前述ASR共3条通过）：相同v10 source/model/title分别跳过已存facts:0或facts:1，只调用缺失fact与draft/audit，不改变传入checkpoint。旧meetingSummary全套存在历史v9期望，本轮未将其宣称全套通过。node512MiB tsc --noEmit exit0。

没有云调用、重转写、实际恢复生成、APK构建或设备安装；仅读取现有元数据并修改TS/离线测试/本日志。已完成转写及speaker原件未改写。本补丁修复可复现的并发凭据竞态，不放宽真实身份切换；真实摘要继续仍由用户/主线程显式触发，未将未保存的partial当已完成事实。

### 2026-10-15｜实机显式恢复纪要完成并从会议列表重新打开

主线程实际显式恢复已完成，并提交内容无关回执data/device-validation-20261015/app-aliyun-22m-final-receipt.json与reopened图片；本次只读核对回执后追加本日志，没有操作设备或发起新请求。record=1792052063450-tqgk6b9acq，note=app-1792052063450-tqgk6b9acq；generation=null、has_error=false。Aliyun模型asr:6:aliyun:22:paraformer-realtime-v2，LLM codex/gpt-6-luna；完整1376.5485625秒区间已保存，transcript共6469字符、区间正文6445字符，speaker仍519条。

summaryCheckpoint共有6个完成键：facts:0、facts:1、facts:2、facts:3、draft、audit。恢复timings中asr-request计数为0，speaker-analysis cacheHit=true；仍发生audio-prepare 124825ms/transcription 125955ms，不能把“零ASR请求”误写为“没有重新准备音频”。恢复facts实际请求索引为0、2、3，已保存facts:1未重复调用；随后draft/audit与note-save完成，总计161804ms。回执记录已打开保存版本、返回录音/任务/文件库、进入会议列表并重新打开保存会议。

根因证据边界：离线复现并修复了不同context同身份并发刷新凭据的竞态；修复后这份已完成转写的实机显式摘要恢复通过。没有取得旧失败调用栈，不将此次成功倒推为旧失败触发栈已直接取证；本结果仅覆盖App Aliyun整段22m57s及显式摘要恢复，不代表Desktop Doubao验收。只追加开发日志，App源码保持冻结；此后停止后台工作，不新增云调用、测试、构建或恢复操作。


### 后续变更：2026-10-16｜wugui / Codex｜服务预算主动规划

[录音服务预算自适应分段](../../2026-10-16/2026-10-16_142000_wugui_无Issue_录音服务预算自适应分段/index.md) 补充protocol1 recordedAudio service_budget合同：预算内真实PCM能量停顿/最低能量规划，替代先整条提交后按sessionLimit自动重发。v5成功区间、原模型、final/cleanup/身份安全规则保留；新增持久化inFlight与旧unknown禁止重试。仅App TS/离线测试/文档，无原生/云调用/安装；不替代上文已发生的Aliyun真机证据，也不宣称新策略已通过真实22m验收。
