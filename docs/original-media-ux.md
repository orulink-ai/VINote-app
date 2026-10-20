# 原件预览、保存与生成确认

## 最新有效范围（2026-10-20 用户再次覆写）

真实录音导出也已接入同一 OS exporter：`recordingLibrary.exportRecording` 保留录音目录/id/扩展名、普通文件、大小及账号校验，额外冻结 identity epoch，直接传原 URI、stat 大小和扩展名推导的音频 MIME，不读取整段字节。返回 `saved/cancelled` 给 `RecordingsScreen`，结果文案独立于进度；action finally 清除 phase，页面按账号 epoch、录音 id/URI 和详情 epoch 接收结果，离开后返回同一录音也不接收旧结果。失败只在原详情显示错误，不把取消当成功。此项补充后最终22 suites/276 tests及TypeScript通过；这是源码/离线证据，不是真机保存验收。

App 会议只录音和分析录音：ASR＋speaker＋summary。视频保留、播放、导出以及录屏/画面分析全部仅桌面；此前“在 App 补视频抽音会议链”的建议已撤销，不再作为待实现缺口。本轮源码撤下新增视频预览与原生播放器，未删除历史原件或推断迁移。

- 新会议/笔记文件导入拒绝视频，Android 在读入自有缓存前核对扩展名/MIME，iOS 在复制前核对扩展名/UTType，JS 再在写入账号文件库前阻止；已有视频条目可读，但没有播放、导出或新生成入口，明确提示历史数据未更改、需人工管理。保留历史元数据与关联正文导航；可见格式筛选仅全部/音频/文档，旧video/screen筛选状态回到全部，不把旧数据伪装成已转换音频。
- 音频、PDF/DOCX 等文档仍可通过系统选择器导出，保留取消/失败反馈、非截断空目标校验、owner/identity/route/selection epoch 保护及 executor 拒绝执行捕获。iOS 继续复用 Share 的文件保存选择器，无新增 AVPlayer。
- 本次模型确认、只GET重新读取、录音 summary-only 完整 ASR/speaker 复用与 unknown 不重放保持。新旧视频文件均不能借新操作重新派发模型；旧 unknown 和已完成结果读取不受此次新文件门禁清空或重放。
- Notes B站链接路径保留，只保存既有下载器验证为纯音轨的 AAC/M4A 并生成笔记，不下载源视频。它的历史 sourceType=video 表示来源，不代表实际音频文件被禁止；门禁核对实际扩展名/分类。

有效写集：删除本轮新增 `OriginalVideoActivity.kt`、manifest 注册、`OriginalLifecycle.java` 及视频生命周期测试，删除 JS preview/close 接口和文件库播放按钮，撤销 iOS AVKit/AVPlayer 相关增量。executor 捕获迁为 `FileTaskDispatch.java` 并保留实际 shutdown 反例；音频/文档复制核心仍保留。`git diff origin/main` 用于确认只撤本轮播放器，既有录音和解码器不被误删。以下正文均是历史实现/建议，不能用于宣称当前 App 支持视频。

本轮离线验证：原15 suites/221 tests基线调整后为15 suites/233 tests，加B站音轨2 suites/11 tests，最终17 suites/244 tests通过；新增视频导入不写副本、历史视频无播放/导出/生成、音频/PDF/DOCX导出及 B站回归。TypeScript通过；Android真实SDK/API classpath手动编译通过，JVM复制与executor/文件类型反例通过。旧CI39293842504/head0a78b5f构建的是收紧前候选，本次源码尚未重建APK或真机验收，未改版本、未提交、未推理。

## 先前产品边界（历史，已被最新范围覆写）

App 会议处理音频或视频中的声音：ASR 转写＋speaker 说话人分析＋summary 纪要。视频画面不参与分析，不增加录屏采集、抽帧、OCR、视觉模型或桌面画面证据链。视频原件继续保留、播放和导出；声音识别不能替代视频原件，也不能把画面内容写成会议证据。summary-only 沿用完整已确认的 ASR/speaker 材料，不重新识别、不静默换模型、不恢复同步。

这是目标范围，不是全部已实现的声明。当前代码能力如下：

| 路径 | 当前实际能力 | 限制 |
| --- | --- | --- |
| App 录音、会议音频导入 | `recordingLibrary` → `generateRecording` → ASR＋speaker＋summary | 录音库扩展名为 m4a/mp3/wav/aac/flac/ogg；仍取决于平台解码器。文件库虽识别 opus，但会议导入的录音库白名单未接纳 opus，不宣称全格式支持。 |
| 笔记资料音视频 | `clientNotePipeline` 对 audio/video 调用 `transcribe`，再调用笔记 LLM | 没有 speaker，不等于会议流水线；没有画面分析。 |
| 会议资料视频导入 | `importLocalFile` 保存 LocalFile，视频可预览/导出 | 没有调用 `importRecording` 或创建会议生成记录；会议视频→声音会议纪要仍是用户范围内待补的功能缺口。 |
| Android 音轨转换 | `MeetingAudioModule.toWav` 使用 MediaExtractor 选择第一条 audio/* 音轨，MediaCodec 流式解码为 16k/mono/PCM16 WAV；ASR 和 speaker 各自复用此能力 | 不处理视频帧；无音轨/解码失败应失败且保留原件。多音轨选择、所有视频格式和真机长视频完整性尚未验收。 |
| iOS 音频转换 | `MeetingAudio.toWav` 使用 ExtAudioFile 流式转换 | 尚无显式 AVAssetReader 视频音轨选择路径，不能由 Android 能力推断 iOS 视频容器支持。 |

最小实现建议（本次仅记录，未改功能代码）：在会议视频详情增加显式生成入口，冻结 owner、原件 file ID/URI/hash、模型与操作，转换成功后将完整声音 WAV 保存在账号录音目录并登记与原视频的可靠来源关联，复用已有会议模型确认及 `generateRecording`。不伪装成普通笔记，不用修改视频后缀冒充音频，也不把 cache URI 当持久原件。持久记录在任何推理前完成；失败、换账号、unknown 保留原件和原操作，不能自动重发。删除规则须识别派生声音对原视频的引用，summary-only 仍按声音材料身份与完整性验证。Android 优先复用现有转换；iOS 对视频需先验证受支持容器，必要时补有界 AVAssetReader 音轨解码，不能默认成功。

下文保留此前实现与验证记录。后续 CI 39293842504 已基于 `0a78b5f66e51ca87da310f38874a8458bf00620e` 成功构建 standalone arm64 DEBUG 候选；这更新了下文“未完成整包构建”的历史状态，不代表视频会议声音链已接通或真机验收通过。未改发行版本，未发布正式版。

文件库选中视频（包括内容详情的“来源文件”）后，可“播放完整原视频”，使用原生播放器的播放/暂停与拖动进度。读取本机账号目录的原始文件，不复制为 JS/base64，不转换或裁剪。格式支持由设备解码器决定；失败可导出原件。不宣称所有 Android/iOS 都支持 WebM/MKV。

“导出文件”打开系统保存位置选择器：Android 使用 ACTION_CREATE_DOCUMENT 流式复制（64 KiB 缓冲），iOS 复用现有 react-native-share 的 saveToFiles（file URL 直接交给 UIDocumentPicker 的 exporting/asCopy，不走 data/NSData 分支）。只有完成回调才显示已保存，取消单独反馈；失败保留原件并提示核对目标。没有新增远端视频下载 API。Android 保存和两端视频预览由 MeetingFiles.originalMediaProtocol=1 提供，旧安装包提示更新；iOS 文件保存复用旧原生能力，不把分享面板打开冒充保存完成。未新增任何存储权限，Android 新播放器 Activity 不导出。

Android 导出只用 `rw` 打开目标，不用截断模式；先要求目标大小为0，未知大小/非空目标拒绝写入。取消不触碰目标；失败时仅关闭本次句柄，不调用 deleteDocument：选择器返回 URI 不构成独立的创建归属证明，宁可提示用户核对可能留下的不完整副本，也不冒险误删已有文件。不增加目录枚举、持久 tree 权限或自动重试。

新笔记生成先核对本次来源与模型：音视频展示 ASR 和 LLM，文字/文档只需 LLM。选择只冻结到本次操作，不写默认模型；确认前目录读取不推理。确认后登记/启动有忙碌反馈，旧 unknown 仍只查询，不能通过换模型或新编号重放。原有录音 summary-only 继续核验完整 ASR/speaker，明确选择总结模型后生成新版，不调用 ASR/说话人分析。

读取失败可直接在确认 Sheet“重新读取模型”，只GET目录/默认选择，不修改draft或生成。owner/identity epoch变更清空旧选择并丢弃迟到响应。同步提交异常解除本次按钮锁，不自动提交；已提交unknown退出确认后只能核验原提交。

会议视频原件尚未接入录音的 ASR/speaker 会议生成流水线；本功能不伪造该能力，不恢复同步。App 不使用桌面 summary-only 或原件 API。

## 验证与发布边界

此次涉及 Android/iOS 原生源码，必须重建 App 后再做实际保存、取消、视频 seek、返回/后台与账号切换检查；Metro Fast Refresh 无法增加这些接口。Jest/TypeScript 通过只证明源码合同，未测量真机峰值内存或原生解码能力。当前没有构建、签名、安装或发布本分支产物。

新增 Android Kotlin/Java 写集已以缓存 Kotlin2.2.0、Android36、React Native0.87.1真实 API classpath 直接编译通过；复制核心6项JVM反例通过。完整Gradle检查受本机JVM loopback/Pipe初始化错误阻断，尚未证明整包构建可用。完整URI与原生seek控件不等于原始无Cues WebM已经验证尾部可达，发行前必须真机原件核验；不承诺all formats。

构建入口保持 `scripts/android-build.cjs` / `npm run android:vinote:apk`（正式签名公网）及直接 Gradle `assembleDebug -PvinoteStandalone=true -PvinoteChannel=public`（独立debug候选）。本轮只尝试 compileDebugKotlin/compileDebugJavaWithJavac，不执行assemble/install。签名配置在 `android/app/build.gradle`，需要 `VINOTE_ANDROID_KEYSTORE`、`VINOTE_ANDROID_STORE_PASSWORD`、`VINOTE_ANDROID_KEY_ALIAS`、`VINOTE_ANDROID_KEY_PASSWORD` 由安全环境注入；本轮不读取或输出凭据。

官方接口依据：[Android 保存选择器](https://developer.android.com/training/data-storage/shared/documents-files)、[iOS exporting/asCopy](https://developer.apple.com/documentation/uikit/uidocumentpickerviewcontroller/init%28forexportingurls%3Aascopy%3A%29)、[AVPlayerViewController](https://developer.apple.com/documentation/avkit/avplayerviewcontroller)。
