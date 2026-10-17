# 2026-10-16 App 离线验证与 APK 交接

已完成本地修改和离线构建，未提交/合入/安装/启动/reload。未操作手机、未清数据、未调用提供方，未启停Metro/Tauri/API。实际App/真实22m验收待用户空闲，由父端看窗口后操作。

## 最新文案和测试

- recordedAudioUsage：适用于录音与会议纪要；长录音优先按停顿分段，始终使用所选模型。
- 缺policy：当前服务的录音转写尚未就绪，请更新服务后重试。
- 识别前phase：正在整理音频分段。边界种类/PCM字节仅记入processingTimings的技术记录，不进入普通进度文案。
- Jest三suite45tests passed（5.511s）：recordedAudioPlanner、recordedAudioTranscription、CloudModelPicker；Node heap256MiB。单遍Python共享fixture边界仍保持。
- 最新tsc --noEmit exit0（Node heap512MiB），包含本轮planner/native句柄失败关闭/产品文案。
- 真实生产Kotlin PcmReaderStore/PcmReaderDiagnostics与既有JVM测试从缓存编译，8+8=16项通过，原件不变、边界/EOF/失败关闭/句柄限制/诊断保密等。compiler Xmx512，runtime Xmx64，串行；不是设备/JNI或MeetingAudio.invalidate桥接验收。
- JVM PID 18672（编译）、17888、15212（测试）均已退出，日志artifacts/android/20261016-adaptive-recorded-audio/pcm-jvm.log。

## 环境与约束

两份speaker SHA256均与脚本manifest完全一致，构建跳过prepareSpeakerModels，不调用下载脚本。SDK=D:/tool/sdk/android，Java21为既有D:/watcher/app/gradle-home/jdks/eclipse_adoptium-21-amd64-windows.2（Temurin21.0.7），Java17为既有C:/Program Files/Microsoft/jdk-17.0.19.10-hotspot。使用已缓存Gradle9.4.1及依赖，--offline并禁止toolchain自动下载。

Java Xmx512MiB / Metaspace256MiB、Node512MiB、Gradle1worker、Kotlin in-process、CMake parallel1；standalone bundler实际命令核对--max-workers1。所有重型启动前可用内存均>=1GiB。standalone运行过程中最低可用内存曾降到13176832 bytes，未再启动其他重型检查；用户要求不打断已开始编译，待完成并恢复内存后才串行构建普通debug。普通debug启动可用3929399296、观察最低2523770880 bytes。这里只陈述全机可用内存观察值，不把512MiB heap当整个构建占用。

## 构建与产物

两包均包名com.vinoteapp.dev，versionName0.2.0/versionCode9，ARM64。apksigner verify exit0/v2有效，证书SHA256一致fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c。apksigner仅96MiB JVM且在Gradle退出后串行执行。

### 优先交给父端的普通 public debug

- 路径：D:/projects/VINote/VINote-app/artifacts/android/20261016-adaptive-recorded-audio/ordinary-debug/vinote-public-debug.apk
- SHA256：6451fb44b1330e9ee12f438986e0c5ee510d79b4610ac47b4470a135f0e79487
- 大小：136752884 bytes。
- Gradle：BUILD SUCCESSFUL in 1m11s，235tasks/24 executed，exit0；runner总75.033s，14:42:45–14:44:00 +08:00。
- 明确省略-PvinoteStandalone参数（该项目用hasProperty，传false仍算开启）。实际生成BuildConfig.VINOTE_STANDALONE=false；结合MainApplication的DEBUG && !VINOTE_STANDALONE，开发支持开启。APK实际不含assets/index.android.bundle，供设备从Metro加载JS。
- 此包原生输入未因本轮JS改动发生变化，SHA与历史普通debug相同是预期；不是把新JS打进该包。Metro当前源码及设备实际获取的bundle/新文案必须后续核对，不能以构建输入manifest或8081监听冒充已热更新。
- runner PID34524、cmd11952、wrapper25088、Gradle22072均已退出。启动前已确认前一轮Gradle退出，未并行两次构建。
- 回执：artifacts/android/20261016-adaptive-recorded-audio/ordinary-debug/build-receipt.json；同目录gradle-build.log、signature-verification.log、apk-badging.log、BuildConfig.java、source-before.json/source-after.json、build-processes.json。

### 备用冻结 standalone debug（不用于热更新确认）

- 路径：D:/projects/VINote/VINote-app/artifacts/android/20261016-adaptive-recorded-audio/vinote-public-standalone-debug.apk
- SHA256：fa6aaa662a5b496972da41e68066bbc441de3a372da3a657ef6fd6e3fe31f7c5
- 大小：138930425 bytes。
- BUILD SUCCESSFUL in 4m35s，236tasks/25 executed，exit0；runner总276.103s，14:37:15–14:41:51 +08:00。
- VINOTE_STANDALONE=true，开发支持关闭；包内Hermes JS bundle2177380 bytes，SHA256=7cd9618ffa4c5f053a0236371ca587918fe51c7fbc83a31c4e700af99f001e0f。构建开始后用户要求保留热更新，按其指示未打断该重型构建，完成后另建上面的普通debug。
- runner PID1152、cmd8684、wrapper33288、Gradle13564、bundler32564均已退出。
- 回执：artifacts/android/20261016-adaptive-recorded-audio/build-receipt.json；同目录gradle-build.log、source-before.json/source-after.json、standalone-BuildConfig.java、signature-verification.log、apk-badging.log、build-processes.json、verified-artifacts.json。

两次成功构建均对192项输入记录前后SHA256且完全相同。包括App源码/入口、配置、原生源/模型资产及Gradle关键配置；不是整个仓库或依赖的完整snapshot。原APK输出android/app/build/outputs/apk/debug/app-debug.apk现为普通debug，两份专门副本已分别保留。

## 失败记录（保留，不掩盖）

1. attempt1：未自动发现已有Java17，toolchain禁止下载按预期关闭，构建24.048s退出1，未进入项目编译。仅构建参数显式传入已有17/21两路径解决；不改系统/JDK配置。
2. attempt2：我添加的init script闭包属性解析到Project，extraPackagerArgs引用错误，36.106s退出1。改为显式reactExtension引用解决。未改产品Gradle/Metro配置；attempt2 init原文保留。
3. 两次失败均保存attempt1-/attempt2-日志/回执；源码输入前后不变，无下载。最终standalone成功仍有既有Gradle/AGP弃用和Metaspace告警，未改依赖/提高heap。

## 热更新与真实验收边界

只读确认8081 PID5216、8900 PID12792、3100 PID23384均仍监听。没有操作手机/安装/reload或修改权限，不能知道当前手机是否连着Metro。本轮不能报App真机、真实22m、前后台、内存峰值或provider final验收完成。

父端后续优先普通public debug，在用户空闲且明确安排受控执行时验证新UI/实际bundle代码hash，再走真实generateRecording pipeline；旧unknown/成功证据继续保留，不借验收清掉unknown。禁止因安装/重启而盲目恢复其他pending任务。构建脚本/日志/签名核验不含提供方调用。
