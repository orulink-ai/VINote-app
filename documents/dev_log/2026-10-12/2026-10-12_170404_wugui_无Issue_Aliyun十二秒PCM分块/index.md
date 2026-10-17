# Aliyun 12秒 PCM WAV 转写

- 作者：wugui；2026-10-12，Asia/Shanghai。
- 用户实测前提：12秒WAV HTTP200且非空，60秒失败；MP3不支持。此处不再调用真实账号/媒体。
- 范围：Android MeetingAudioModule、meetingCloud、相关聚焦测试。原件只读，旧60秒接口保留，新12秒原生能力缺失时拒绝长块，不安装或中断手机任务。
- 最初meetingCloud候选暂存为`.ts.patch`，目录被既有Metro blockList排除，以避免主动打断当前任务。随后用户明确要求立即落盘JS；已覆盖同一任务开始时的源文件，仅此范围，未主动Reload、安装或手机输入。不能据此声称当前任务未受Fast Refresh影响。
- 新检查点记录切块时长。已核验同源旧60秒结果保留原分钟归属，不拆成虚假的12秒文字；未完成区间用12秒补齐。来源或模型变化不复用文本。
- Red：新130秒用例在原JS失败，实际调用旧60秒接口。Green：候选验证后，最终实际源文件三组Jest（meetingCloudAliyun、meetingCloud、meetingTranscription.performance）30 tests通过；Node512/runInBand，0.606秒。实际源文件`node --max-old-space-size=512 node_modules/typescript/bin/tsc --noEmit` exit0。
- 用例覆盖：130秒11块、Aliyun串行、缺新原生能力拒绝POST、旧同源分钟段保留只补缺、502最多两次重试及成功检查点复用、来源/模型变化失效、v4重开不提交、写盘失败不宣称进度保存。
- 原生编译、手机执行、真实Aliyun长期可用性均未验证。遵照最新指令未跑Gradle。当前APK需后续包含wavChunk12，HMR不能更新原生方法。
- 历史参考：[空识别与导出](../../2026-10-10/2026-10-10_110336_wugui_无Issue_长录音空识别与原音频导出/index.md)。
