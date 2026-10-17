# 长录音说话人分析有界内存

- 作者：wugui；2026-10-12 Asia/Shanghai。
- 用户实际证据：78分10秒录音，17:35:28 Android LOW_MEMORY，PSS约0.91GB、RSS约862MB；不是本次自行采集。
- 静态定位：旧MeetingSpeakers整段FloatArray，4690秒×16000×4=300160000字节，约286MiB；JNI/ONNX额外复制及模型内存未实测分解。JS并行ASR/说话人会叠加转换/上传/模型阶段。
- 实装：analyzeWindow单调用最多130秒（120秒核心+左右各5秒），原生输入最多8320000字节，约7.9MiB；每窗engine finally release。旧analyze也拒绝超界整段分配。原件只读，时间偏移按核心裁切，重叠保留。静音窗允许完成。
- JS按源指纹与analysis.version=2/windowSeconds=120保存completedWindows及原始时间轴；每次保存成功后推进进度。失败重试跳过已保存窗口。窗口局部编号不等同于同一个人，最终身份只由已有有界特征重聚类产生，缺乏证据为unknown。
- 超过十分钟或时长未知的录音两路顺序执行；第一路失败仍保存第二路独立成功产物，原有错误/暂停和人工重试语义保留。
- 验证为事后聚焦回归，不声称TDD先红：meetingSpeakers/generateRecording/speakerClustering/recordingProcessing共4 suites29 tests通过，Node512/runInBand；实际App tsc --noEmit exit0。类型检查最初发现测试类型及局部分析类型错误，修正后通过。
- 未运行Gradle/安装/手机输入/真实推理，未触碰当前构建；不能声明当前打包APK含本补丁。需下一次原生重建安装和同78分钟录音内存复验。
- 风险：ONNX本身的固定模型占用、系统整体压力仍存在，无LOW_MEMORY免疫保证；窗口边界与跨窗身份精度未实测；逐窗加载模型及长录音两路顺序执行可能增加耗时。旧Android/iOS原生模块无analyzeWindow时仅120秒内可用旧分析，长录音明确阻止回退；iOS未实现本原生接口，不宣称兼容长录音。
- 文件：android/app/src/main/java/com/vinoteapp/MeetingSpeakers.kt、src/lib/meetingSpeakers.ts、src/features/recording/generateRecording.ts及两份相关测试。

## 后续补充

- 2026-10-17：见 [iOS 说话人分窗补齐与 Release 地址复核](../../2026-10-17/2026-10-17_101000_wugui_无Issue_iOS说话人分窗补齐/index.md)。补此前缺失的 iOS analyzeWindow 源码与有界 PCM 读取核心；原 JS 检查点/编号/偏移合同及本档案历史证据保留。Windows 离线测试不能代替 iOS 原生构建和第三方推理验收。
