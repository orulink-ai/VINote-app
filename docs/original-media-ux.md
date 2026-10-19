# 原件预览、保存与生成确认

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
