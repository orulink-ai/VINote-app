# 录音服务预算自适应分段

后续补充（2026-10-16，wugui/Codex）：[完整录音仅总结恢复](../2026-10-16_174500_wugui_无Issue_完整录音仅总结恢复/index.md) 为完整已确认ASR/speaker增加显式仅LLM入口；本档案的分段与unknown禁止重放契约继续有效。

- 创建：2026-10-16 Asia/Shanghai；建档作者：wugui；参与：Codex。
- 状态：源码及离线验证完成，待实际安装与受控真机验收；本地修改；无Issue；写集仅 VINote-app。
- 目标：消费 capabilities.recordedAudio protocol1 adaptive_pause service_budget；不从模型名推断时长。PCM16k mono预算640..64MiB偶数字节。真实20ms能量窗、240ms持续相对静音、预算末1/3最新静音中点，否则最低能量窗中点。复用区间原生reader，有界读取，不wholefile加载。
- 安全：仅final落盘计confirmed；提交前持久化未确认区间，失败/中断不自动重放；旧unknown不可重试，历史成功检查点保留。缺policy阻止新提交，完整成功证据仍可恢复。
- 验证计划：离线policy/真实PCM规划/分段与失败恢复/旧证据回归、tsc；零云调用、无设备安装/卸载/清数据，不改根backend/server。
- 历史：[自适应流式转写](../../2026-10-13/2026-10-13_190000_wugui_无Issue_自适应流式转写与插件商店/index.md)。补充服务主动预算规划，替代先整段提交后收到limit续接；已有final/cleanup/身份守卫继续适用。


## 最终实现与证据

- 服务policy独立于健康/模型能力选择。支持640..64MiB偶数字节；缺失/未来协议/错误预算均关闭新提交，没有客户端2MiB默认猜测。
- 规划器读取每段候选预算内PCM，峰值能量需全段计算；只保留末1/3能量窗。native读取每次<=6400B，最大policy限制末段窗数量；不是整文件加载，也不是原生VAD。连续讲话明确以最低能量中点切分，不假称停顿。最小/非640倍数偶数budget也严格按sample不超限。
- 已确认正文沿用v5 intervals；inFlight是独立未确认标记，不是转写结果。每次recognizeInterval之前落盘，任何失败/中断保守保留标记，禁自动/显式重放；不重新解释历史sessionLimit进行自动缩段重放。完整旧成功覆盖零ASR/零policy请求。来源/模型改变时保留旧checkpoint，关闭新提交。
- 旧unknown在worker入口前阻止操作，前台恢复跳过，界面确认禁用且handler再次防御；不清空errorDetails或改绑默认模型。缺policy的健康模型仍可选择，文案说明调用方式待更新，不判为模型不支持。
- 原有脏工作区保留。只写VINote-app；未写根backend/server，未commit/push，未启动/停止主端服务。

## 验证记录

- Red：新测试首次运行失败于policy模块尚不存在（1 suite failed / 0 tests）；随后实测捕获测试fixture默认undefined与文案断言问题，修复后新planner 17项通过。没有把模块缺失冒充生产根因复现。
- Green：最终 `node --max-old-space-size=512 node_modules/jest/bin/jest.js __tests__/recordedAudioPlanner.test.ts __tests__/recordedAudioTranscription.test.ts __tests__/meetingCloudAliyun.test.ts __tests__/asrReplaySafety.test.ts __tests__/generateRecording.test.ts __tests__/CloudModelPicker.test.tsx __tests__/recordingProcessingStatus.test.tsx __tests__/RecordingsScreen.generation.test.tsx __tests__/models.test.ts __tests__/nativePcmReader.test.ts __tests__/modelEligibility.test.ts --runInBand --watch=false`：**11 suites / 143 tests passed，8.631s，exit0**。
- 覆盖：合成22m57s真实PCM字节扫描→实际transcribe/planner/native reader JS路径→mock recognizeInterval，连续采样覆盖/严格预算/原模型、final-only正文、第二段未知/中断持久化、缺policy、旧成功/旧unknown、失败保存、模型适用原因与恢复界面。模型目录和提供方均mock，不能称真实App pipeline或真实provider通过。
- `node --max-old-space-size=512 node_modules/typescript/bin/tsc --noEmit` 最终exit0。中间一次新测试Buffer类型报错已修复，未增加依赖。
- 扩展回归中状态文案旧断言5项失败，去除重复标题并更新“不许重试unknown”的新合同后，两suite30 tests通过；最终上述11suite全部通过。
- 指定已跟踪文件 `git -c core.whitespace=cr-at-eol diff --check` exit0，仅仓库既有LF/CRLF提示。未执行全项目/原生JVM/Gradle/真机/云端验证，没有内存或读盘速度验收结论。
- [实际App受控验收准备与串行构建命令](controlled-app-acceptance.md)：未执行；SDK以主端最后提供的D:/tool/sdk/android为准。

## 本轮直接编辑路径（相对VINote-app）

代码：
- src/lib/recordedAudioPolicy.ts（新增）
- src/lib/recordedAudioPlanner.ts（新增）
- src/lib/recordingASRSafety.ts（新增）
- src/lib/models.ts
- src/lib/meetingCloud.ts
- src/features/recording/generateRecording.ts
- src/components/CloudModelPicker.tsx
- src/components/RecordingProcessingStatus.tsx
- src/screens/RecordingsScreen.tsx

测试：
- __tests__/recordedAudioPlanner.test.ts（新增）
- __tests__/recordedAudioTranscription.test.ts（新增）
- __tests__/meetingCloudAliyun.test.ts
- __tests__/asrReplaySafety.test.ts
- __tests__/generateRecording.test.ts
- __tests__/CloudModelPicker.test.tsx
- __tests__/recordingProcessingStatus.test.tsx
- __tests__/RecordingsScreen.generation.test.tsx

文档：AGENTS.md、README.md、本目录index.md和controlled-app-acceptance.md，以及关联旧档案index.md后续变更链接。无Android/iOS原生源码改动。

## 收尾

离线实现已完成，实际App安装、真实22m音源规划性能和受控提供方最终结果验收留主端安排。本轮零云调用、无Gradle、无adb/安装/卸载/清数据。既有native APK无需因接口变化重建，但验收要求实际安装包含本次JS的冻结构建，不能以HMR/mock替代。


### 后续同任务对齐｜2026-10-16｜wugui / Codex

用户指出Python采用单遍running peak与完整hop起点search，要求同budget同边界；随后提供RAM仅500MiB的新约束。未启动任何native编译/Gradle，暂停大检查，保留Metro/Tauri/scrcpy。本节替代上文初版global peak/tail数组/6400B扫描的实现描述，历史验证数仅对应当时源码。

- 改为Python逐窗同算法，first+floor(maximum*2/3)起点、running peak、quietest <= 最近窗、3840samples资格、bestPause逐窗更新并在遇声后保留。
- 规划扫描使用已有RNFS原生区间读取，每批64000B（100hop），不改专属native reader的6400B边界，不新增native。只分配当前PCM批缓冲，无tail存储。base64字符串与桥接解码存在额外有界内存，不将64KiB的PCM缓冲谎称为整个进程/桥接总内存上界。
- __tests__/fixtures/recorded-audio-boundaries.json新增8个共享PCM样例与完整expectedIntervals，含持续静音、连续tone相同能量取最新窗、latest pause、running/global peak反例、offset、640/642边界及exact final。实际只读执行父端app/services/adaptive_asr_policy.py生成并核对，无根仓库写入或__pycache__。
- 新增scripts/check-recorded-audio-parity.py供两端重复消费fixture：真实Python函数8/8通过，全部完整sample区间一致；不是另写Python参考克隆。
- `node --max-old-space-size=192 node_modules/jest/bin/jest.js __tests__/recordedAudioPlanner.test.ts __tests__/recordedAudioTranscription.test.ts --runInBand --watch=false`：2 suites / 37 tests passed，4.493s，exit0。包含真实TS planner与Pythonfixture一致、64000B批次数/偏移、短读/取消、22m57s合成PCM扫描次数<1000与预算/confirmed/inFlight回归。
- 本次对齐后未再跑tsc/全suite或native编译，遵照低内存只做小测试；上一节143tests/tsc是对齐前证据，不冒充新版全量验证。native源码未动，JVM PCM tests尚未执行，设备桥接性能/真实22m全pipeline仍待受控验收。
- Gradle时机：当前500MiB可用RAM时继续暂停。主端解除低内存限制后，使用controlled-app-acceptance.md中已准备的1worker离线串行构建；无自动启动/安装/云调用。


### 同轮纠正：64k RNFS路径撤回，保留安全原生句柄

检查实际node_modules/react-native-fs/android/src/main/java/com/rnfs/RNFSManager.java:237 read发现：getInputStream打开后返回base64，正常/异常均没有close流；getInputStream:104实际调用ContentResolver.openInputStream，并非可依赖的自动close。上节64k合成stub测试不能覆盖这个资源缺陷。因此立即撤回RNFS 64k扫描，未改node_modules，也未做新native；保留单遍算法，恢复已有专属reader6400B+finally close。Android缺native句柄时新增失败关闭，不回退该不安全路径。64k bridge优化在不改native的约束下未完成，后续需独立原生能力，不伪称已完成或减少到<1000实际调用。

撤回后两suite37tests再次通过（4.821s/exit0）；Python共享8个fixture仍逐sample一致。随后补充Android缺native失败关闭用例（最终结果以追加记录为准）。本次未执行native编译/Gradle/tsc或设备测试，遵从500MiB低内存约束。正式README/AGENTS已修正为6400B安全路径；上节64k历史实验保留作为被撤回方案证据。

最终小测试：`node --max-old-space-size=192 node_modules/jest/bin/jest.js __tests__/recordedAudioPlanner.test.ts __tests__/recordedAudioTranscription.test.ts --runInBand --watch=false`，2 suites / 38 tests passed，5.387s，exit0，含Android缺native句柄时零读盘且明确失败关闭。真实Python共享fixture8/8通过。该新版未重新执行tsc/全suite/原生编译；无Gradle、云端或手机操作。


### 文案产品化与获准离线构建｜2026-10-16｜wugui / Codex

用户恢复内存后明确授权离线1worker构建，先改普通UI文案并完成45项Jest/tsc及16项真实生产PCM Kotlin JVM回归，再构建standalone。进行中用户要求保持热更新且不要打断已开始编译；standalone完成后串行构建普通public debug。两包构建、同签名/包名/standalone开关/包内bundle存在性已离线核验，192项输入hash构建前后完全一致。所有相关构建进程已退出，手机未操作、未安装/启动/reload、零provider调用。8081监听不等于设备热更新已接通。

[完整构建交接、APK路径/SHA256、PIDs、成功与失败回执及内存证据](build-handoff.md)。普通debug优先交父端；standalone只作冻结产物。旧“尚未构建/暂停Gradle”是此前低内存阶段的历史事实，当前状态由本条替代；真实App/22m验收仍待用户空闲。未修改根backend/server或启停主端服务，未commit/push。
