> 2026-10-16 最新交接：用户要求保持两端热更新，后续优先使用已构建的普通public debug（省略vinoteStandalone参数）。standalone冻结包也已构建但开发支持关闭，仅备用。两包均未安装/启动/reload，实际App验收待用户空闲。构建结果、SHA256和原始回执见[build-handoff.md](build-handoff.md)。下文“未执行”保留为准备阶段原始记录，实际状态以上述最新回执为准。

# App 真实受控验收准备（未执行）

本轮只执行离线 Jest/tsc。没有原生源码变更、Gradle/JVM原生编译、adb、安装或提供方调用。nativePcmReader 的 Jest 回归通过仅代表 JS 契约，不代表设备桥接、速度、内存或真实提供方验收。

## 冻结构建与保留资料

主端提供的当前环境：SDK `D:/tool/sdk/android`、设备 `<device-serial>`，API8900/Vite3100/Metro8081已由主端恢复。它们未由本任务复核或操作。RAM约3GiB可用；不同时启动大构建/其他重型验证。

本项使用已有native PCM reader，原生不需新增。要满足实际安装验收，建议构建带冻结 JS 的 public standalone debug，包名仍 `com.vinoteapp.dev`。普通debug依赖Metro，单装历史APK不能证明加载了本轮JS。不得用正式包/不同applicationId冒充原账号安装。

以下仅准备命令，不自动执行。先确认deployment.json已是public、当前debug签名与已装包一致、Gradle/JDK21/Android/NDK依赖均已缓存。若缺缓存停止，不在线下载。先只读核对以下两份模型SHA256；跳过prepareSpeakerModels只在完全匹配时使用，不能运行脚本触发下载：

- android/app/src/main/assets/speaker/segmentation.onnx：220ad67ca923bef2fa91f2390c786097bf305bceb5e261d4af67b38e938e1079
- android/app/src/main/assets/speaker/embedding.onnx：1a331345f04805badbb495c775a6ddffcdd1a732567d5ec8b3d5749e3c7a5e4b

PowerShell cwd 为 VINote-app/android；环境仅对当前构建进程及子进程设置，执行后恢复原值。先创建并确认仓库内pipe目录；既往JDK在8.3 TEMP路径有UnixDomainSocket问题，不改全局配置。

```powershell
$env:ANDROID_HOME='D:/tool/sdk/android'
$env:ANDROID_SDK_ROOT='D:/tool/sdk/android'
New-Item -ItemType Directory -Force -Path 'D:/projects/VINote/VINote-app/.gradle-user-home/jdk-pipe' | Out-Null
$env:JAVA_TOOL_OPTIONS='-Djdk.net.unixdomain.tmpdir=D:/projects/VINote/VINote-app/.gradle-user-home/jdk-pipe'
$env:JAVA_OPTS='-Xmx64m'
$env:NODE_OPTIONS='--max-old-space-size=512'
$env:CMAKE_BUILD_PARALLEL_LEVEL='1'
.\gradlew.bat :app:assembleDebug --offline --no-daemon --max-workers=1 '-Dorg.gradle.jvmargs=-Xmx512m -XX:MaxMetaspaceSize=256m -Dfile.encoding=UTF-8' '-Pkotlin.compiler.execution.strategy=in-process' -PvinoteChannel=public -PvinoteStandalone=true -PreactNativeArchitectures=arm64-v8a -x prepareSpeakerModels --stacktrace
```

本轮未执行此构建，不能声称成功或分发本轮APK。实际完成后应保存构建日志、APK SHA256、包名/版本/签名、bundled JS及本次源码hash；确认包含本轮planner/inFlight逻辑。主端选时机后才用完整adb路径对指定设备执行`install -r`，绝不卸载或清数据。签名不匹配则停止，保留现有资料。启动前先核对没有可自动恢复的其他pending任务；启动可能恢复旧pending，因此不能把安装/启动视为不会发生付费调用的保证。

## 明确授权后才执行真实App pipeline

1. 先只读留存待验录音、旧unknown、旧完整成功记录的非正文元数据与检查点摘要。选从未提交的新录音条目；如要复用旧unknown原件，必须独立导入新条目并由用户明确同意一次新的处理，绝不清除/修改unknown后在原任务重试。不用已有完整ASR缓存替代本次全链路测试。
2. 实际安装对应构建，在App“会议资料/导入录音→确认所选模型→生成会议纪要”走真实generateRecording→transcribe→planRecordedInterval→recognizeInterval；不可用测试stub、DEV直接调用recognizeInterval或Python结果替代。保持单个generation slot，不同时点第二条任务。
3. 只读核对真实目录相同模型的protocol1 policy，记录服务budget、具体模型ID/Origin与源指纹。缺policy必须停在服务调用方式待更新、零音频提交；不能换模型或改用22m整段。
4. 逐段核对相邻start/end相等、以16000Hz sample对齐、PCM字节差<=服务budget。每段一次原模型调用；partial/LAST/enqueue ACK不计确认。final且checkpoint落盘后才推进confirmed。规划可与父端离线结果比较，段数/速度差异先检查算法和真实PCM，不改模型名阈值去对齐。
5. 实际失败立即停，保留inFlight、成功区间、speaker结果及原件，不自动重放。不为完成验收点击旧unknown重试。重新打开App可只读核对阻止执行，但应先确认不存在其他可恢复pending。
6. 全部ASR确认后继续真实speaker/summary/audit/note-save，最终从会议列表重新打开对应版本、回听原录音。分别记录ASR成功、摘要成功、实际保存/重新打开；失败不伪报全流程完成。不要导出正文、音频或凭据到诊断日志。

这里只准备流程；任何实际提供方调用（包括模型测试、ASR、摘要）均须主端/用户明确选定本轮受控执行时机，当前禁止主动调用。22m原音实时pacing、native读盘性能、峰值内存、前后台/进程中断及提供方final均待真机验收。
