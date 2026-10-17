# iOS 说话人分窗补齐与 Release 地址复核

- 作者：wugui；参与者 Codex；2026-10-17 Asia/Shanghai；无 Issue。
- 状态：源码补齐、定向离线检查通过，待 macOS 编译及 iOS 设备验收；未提交。用户授权最小修复和定向离线测试，不切分支、不操作设备或云端。
- 主线程已确认 fetch 后 App origin/main 最新仍为 0f698a4939735a210bef5500ca12d256eef6ae0a。

## 目标与边界

复核 Release 内容处理地址的真实构建链；补齐 iOS analyzeWindow，使同一 JS 有界分窗/偏移/检查点合同有原生实现。不改 ASR 预算、模型、120 秒核心窗口的既有历史格式、账号/飞书或根后端。

## 调查

- scripts/android-build.cjs -> select-deployment.cjs 只选择 JSON；Babel 只校验配置，没有地址替换。iOS bundle phase 也没有内容处理地址注入。integration.ts Release generationBaseUrl 固定空，且现有 AGENTS 已明确标为未配置。不是某个已存在配置被遗漏消费；不能臆造域名或复用 VILab/飞书地址。该项是服务未配置的交付范围限制，不修成猜测的服务地址。
- iOS 仅 analyze/embeddings，JS 新资料需要 analyzeWindow；原实现整段分配 float。需补真实 native 接口和有界读取，不能删除 JS 门禁以退回整文件分析。
- 采用现有 Android 的单次 PCM 资源上界（130 秒，含 JS 上下文），不是模型时长限制。新 native 不新增 120 秒总录音限制；JS 仍负责整段拆窗、源指纹、核心裁切、窗口编号隔离与保存后推进。
- 可验证：共享于真实 native 的可移植 C 区间校验/PCM 读取核心、JS 分窗合同和配置路由离线测试。Windows 无 Foundation/React iOS/Apple linker，不能证明 Objective-C/Pod/第三方推理或设备内存通过。

## 关联历史

补充 [长录音说话人有界内存](../../2026-10-12/2026-10-12_174014_wugui_无Issue_长录音说话人有界内存/index.md)，仅补此前缺失的 iOS 实现，不改写旧 Android 验证结果。

## TDD / 验证

### Red

- C harness 首次因 SpeakerAudioRange.h 尚未创建而编译失败，未执行断言；这是初始化失败，不是生产缺陷行为复现。
- `node --test scripts/ios-speaker-contract.test.cjs`：两项失败，实际旧源码缺 analyzeWindow 导出、Pod 没有 C 核心头文件接线。此处只检查源码接线，不把正则检查当桥接运行测试。

### 实现

- ios/MeetingSpeakers.m 新增与 JS 同签名 analyzeWindow(uri,start,end,jobId)，复用串行 worker、模型配置和推理调用；legacy analyze 共用 analyzeRange。原件只读，路径仍限制 App 的 asr-*.wav 临时缓存。
- SpeakerAudioRange.h 为真实 native 使用的 C 核心：严格校验 44B PCM16/16k mono WAV、RIFF/data/文件长度、有限且采样对齐的区间；fstat 在已打开的同一描述符读取长度。只分配单窗 float（最多 8,320,000B），每轮读 PCM 缓冲 8192B；不把这些数字声称为 ONNX/整个进程内存上限。legacy analyze 也不能绕过单窗预算。
- 采样索引仅容忍浮点误差，不向下截断已有精确尾区间。静音窗口 total=0 返回空 segments，由 JS 保存覆盖；模型错误、负数量、缺结果、非法时间轴仍失败。文件、segment/result、engine 和 float 始终在 finally 释放。
- 不改变默认模型、ASR 请求、JS 分窗长度、旧 checkpoint 格式、重试或飞书行为；不引入 120 秒总录音/模型时长限制。
- VINoteSpeakers.podspec 纳入实际头文件。没有新增依赖或更新第三方版本。
- README 更正混淆内容处理与飞书 Origin 的旧描述；Release generationBaseUrl 继续为空，明确没有构建注入，不造域名。

### Green（串行，Windows）

1. `python scripts/check-ios-speaker-range.py`：exit0。GCC -std=c11/-Wall/-Wextra/-Werror 编译并运行真实 C 核心；覆盖非零窗口、121 秒单窗、资源上界拒绝、1376.5485625 秒原录音尾窗、采样对齐/NaN/Infinity/越界、坏 WAV、实际 PCM 字节转 float、跨读缓冲连续性及短读失败。只合成少量测试字节/临时文件，不读取用户原音。
2. `node --test scripts/ios-speaker-contract.test.cjs scripts/validate-deployment.test.cjs`：6/6 passed，exit0；两项是 iOS 导出/Pod 源码接线，另外四项为既有配置校验。没有选择/改写 deployment.json 或联网。
3. `node --max-old-space-size=192 node_modules/jest/bin/jest.js __tests__/integrationRelease.test.ts __tests__/meetingSpeakers.test.ts __tests__/speakerPhaseEvents.test.ts --runInBand --watch=false --silent`：3 suites / 17 tests passed，1.130s，exit0。新增 iOS native mocked 的119/120/121秒及22m57s形状分窗完整覆盖检查；既有失败保留窗口、静音覆盖、偏移/编号/旧模块不回退继续通过。Release 检查真实 integration.ts：缺服务时零 token、零 fetch，不借 VILab/飞书地址。
4. `node --max-old-space-size=256 node_modules/typescript/bin/tsc --noEmit`：最终exit0，5.9s。初次仅新测试中 global 名字未定义的4项类型错误；改为 globalThis 后通过。随后仅变动测试再次单独 Jest integrationRelease，2/2 passed，exit0。

首次未 silent 的 Jest 3 suites13项通过，但已有 native mock 缺 addListener/removeListeners 警告；没有为静音修改产品或无关测试。17项是新增平台边界用例后的最终结果，不和初次结果相加。

## 本轮精确写集

- 原生：ios/MeetingSpeakers.m、ios/SpeakerAudioRange.h、ios/VINoteSpeakers.podspec。
- 测试/脚本：ios/speaker-range-tests/SpeakerAudioRangeTest.c、scripts/check-ios-speaker-range.py、scripts/ios-speaker-contract.test.cjs、__tests__/integrationRelease.test.ts、__tests__/meetingSpeakers.test.ts。
- 文档：AGENTS.md、README.md、本 index.md、旧长录音有界内存档案 index.md 的反向链接。
- 父仓库 data 中补交付报告/清单，不写父端源码。未改 Android 业务源码、App.tsx、ASR、账号或飞书文件。

## 未验范围与后续 commit

- 无 macOS/Xcode/CocoaPods 编译；Objective-C 签名及 C API 调用虽然沿用既有绑定，仍需真实 Apple toolchain/已固定 Sherpa 框架链接验证。C 测试不是 iOS 模块或第三方推理执行。
- 无 iOS 真机、模型质量、跨窗声音准确度、后台/取消或内存峰值验收；不能声称 iOS 长会议已完整成功。新 native 需重建，不能 HMR 代替。
- 主线程报告 Android Metro BUNDLE 后白屏并已恢复 USB reverse；本任务未操作设备、Metro、进程或网络，不把离线结果当白屏解决依据。
- 交付准备时将本修复作为完整产品基线之后的独立修复 commit；现在不 commit/add/切换分支。先冻结最终写集，再核对主线程并发修改与当前工作区，避免整文件暂存混入历史脏改。
- Release 内容处理依旧是明确未配置范围，待有真实受信任服务合同后独立处理，不以本轮原生修复宣称可用。
