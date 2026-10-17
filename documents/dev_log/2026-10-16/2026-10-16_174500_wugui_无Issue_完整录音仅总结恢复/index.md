# 完整录音仅总结恢复

- 建档作者：wugui（当前 git user.name）；实现：Codex。时区 Asia/Shanghai。
- 状态：源码和离线回归完成，未提交、未构建、未操作设备、零云调用；实际 UI/提供方验收由父任务负责。
- 背景：完整 ASR/speaker 已保存而总结供应商不可用时，应明确选择另一 LLM，仅生成新版纪要。

## 边界与写集

- `generateRecording.ts` 新增独立 generateRecordingSummary；普通生成保留。`recordingLibrary.ts` 只扩展 generation.summaryOnly 类型。
- `recordingSummaryRecovery.ts` 从当前 owner 目录重读记录，检查 uri/id、文件 size/mtime、ASR 模型、精确连续完整 PCM 对齐区间、speaker 同源同 duration、完整窗口与 clusteringVersion2。使用确认区间构建输入，非空 transcript 本身不证明完整。只 stat，不读 PCM，不调用 transcribe/analyzeSpeakers。
- `RecordingsScreen.tsx` 在已有 Sheet 增加一个“仅生成纪要”动作；`RecordingSummaryRecovery.tsx` 在同一 Sheet 内核对材料并只选择 LLM，不写全局模型偏好，保留返回和至少48dp取消/选择控件。
- 新总结使用 max(lastNoteVersion+1,nextNoteVersion)；旧 note 不删除。原 asrModel、ASR/speaker checkpoint 不改。更换总结模型清空旧 summary checkpoint；同模型、同证据的显式继续保留已完成 parts/version。
- 失败一律 paused，resumePendingRecordings 跳过 summaryOnly。没有声称 summary v11 存在 inFlight/attempt marker；再次请求需要明确确认费用，不能把暂停当作自动重试授权。summarylib 由 Godel 负责，本任务未修改。
- 仅总结路径不调用 queueAutomaticDelivery；普通生成既有已授权交付逻辑不变。

## 验证

- 初次接口 Red：新测试因 helper 尚未实现而报 module not found，0 tests；这是未实现接口的初始化证据，不冒充行为断言失败。
- 核心初次 Green：recordingSummaryRecovery.test.ts，16/16 通过。
- 最终串行小回归：`node --max-old-space-size=192 node_modules/jest/bin/jest.js __tests__/RecordingSummaryRecovery.test.tsx __tests__/recordingSummaryRecovery.test.ts __tests__/generateRecording.test.ts __tests__/RecordingsScreen.generation.test.tsx __tests__/RecordingsScreen.navigation.test.tsx --runInBand --watch=false`：5 suites / 62 passed，11.471s，exit0。
- 最终类型检查：`node --max-old-space-size=256 node_modules/typescript/bin/tsc --noEmit`：exit0。检查串行执行，未跑 Gradle/APK/Metro 命令。
- 覆盖：完整样本形状、空区间/缺口/重叠/非采样边界/unknown、source/model/owner 错配、不完整 speaker、旧失败模型隔离、失败 checkpoint 保留、只选 LLM、返回/取消、普通生成回归。网络/设备均 mock，不构成真实提供方验收。

## 历史关联与待验收

- 补充[服务预算自适应分段](../2026-10-16_142000_wugui_无Issue_录音服务预算自适应分段/index.md)：只复用其完整已确认结果，不改变 policy、分段或 unknown guard。
- 父端提供真实样本：duration metadata1377；ASR/speaker精确 duration1376.5485625，完整 v5 单区间、12/12 speaker窗口、clusteringVersion2。源码可接受该证据形状；本任务没有读取设备缓存或运行其音频。
- 待父端：选择完整样本→仅生成纪要→明确选择 Deepseek→确认→保存新版本→重开；验证旧版仍在，ASR/speaker 没有新作业。旧 Doubao 非空 transcript 但空 intervals 的样本必须拒绝。

## 父端 UI 预检后的小修复

- 父端发现普通生成的长模型列表将仅总结动作推到滚屏底部。将唯一“仅生成纪要”按钮移动到说明/错误之后、CloudModelPicker或原模型说明之前；不增加入口，不改变生成和鉴权逻辑。modelDisplay 由 Godel 另行修改，本任务未触碰。
- 补充断言该按钮仅有一个且在 CloudModelPicker 前。串行 Node192 Jest 三个 screen suites：RecordingSummaryRecovery、RecordingsScreen.generation、RecordingsScreen.navigation，17/17 passed，3.355s，exit0。未 build、未操作设备、零云调用。该小修复源码已停止修改。
