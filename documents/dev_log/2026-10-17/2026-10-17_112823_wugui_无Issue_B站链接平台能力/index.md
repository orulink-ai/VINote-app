# B站链接平台能力

- 作者wugui，参与者Codex；2026-10-17 Asia/Shanghai；分支codex/app-meeting-notes-feishu；PR10。
- 状态：进行中，仅App交付目录本地修改；用户明确禁止commit、部署和真实ASR/LLM。
- 目标：支持显式video_url_platforms平台列表，仅B站开放时恢复入口并限制其他视频；旧device video_url=true且无列表保持兼容。
- 方案：显式列表限定平台，不从video_url=true推断所有平台；缺列表用旧布尔。列表格式错误失败关闭。UI与提交共享策略，公网API当次预检再约束来源。
- 已读AGENTS、开发档案规范/模板、旧Release档案，以及ui-skills-root与CLI选出的react-native-best-practices；复用现有状态组件，不引入依赖/native或无依据性能重构。
- 验证：待追加实际Red/Green；没有调用真实模型或后端。
- 历史：[Release内容服务](../2026-10-17_104109_wugui_无Issue_Release内容服务与离线CI/index.md)，部分替代当时全部视频禁用说明；部署/真机边界仍待核实。

## 实现与协议

- 显式列表优先，允许通用video_url=false与bilibili例外并存；video_url=true加列表也不能扩大到列表外视频。列表为空禁全部视频；未提供列表保持旧device布尔合同。当前App仅开放所声明的bilibili平台，支持bilibili.com及b23.tv；其他已知视频站和媒体直链提示导入文件。任意普通网页仍由后端安全提取，客户端平台判断不是出站安全allowlist。
- video_url_platforms必须为<=16个唯一小写平台标识数组；null、字符串、对象、空条目、重复、非法名称在capabilities校验中失败关闭。没有依赖/原生变更、后台任务或额外请求。
- NoteIntakeScreen复用只读就绪检查，按能力恢复“网页、B站或文档链接”和b23.tv提示；禁止列表外明确视频的生成按钮。submitIntake在unknown标记和POST前复核；production integrationJson依据当次caps再验证JSON来源，能力收窄时不POST。已有未知提交继续只查询。

## TDD和验证（Windows，离线网络守卫）

- Red：新增intakeCapabilities测试最初8项失败，原因新平台判断API尚未实现；记录为缺API的测试初始化失败，不冒充8个既有行为缺陷。
- Green：定向intakeCapabilities/integrationRelease/noteIntake/NoteIntakeScreen/NoteIntakeScreen.models共5suite91tests通过。覆盖B站长/短链接、YouTube/抖音/媒体直链、空列表、非法列表、旧无列表、false+显式bilibili、UI与API双门槛。
- node --max-old-space-size=256 node_modules/typescript/bin/tsc --noEmit：exit0。
- node --require ./scripts/offline-network.cjs --max-old-space-size=192 node_modules/jest/bin/jest.js --runInBand --watch=false --silent：124suite1134tests全部通过，22.058s，exit0；未进行真实网络、ASR或LLM。
- git -c core.whitespace=cr-at-eol diff --check：exit0；沿用Windows换行检查，无无关重排。

## 状态和边界

源码与离线验证完成，全部未提交；HEAD保持a9174e4。未改root、原App运行目录、配置、CI或原生代码；没有部署、真机、下载完整链路或提供方验收。后端平台声明/出站限制和实际B站请求由主线程统筹。本次精确产品patch仅含4源码文件，置于忽略artifacts/delivery-prep/bilibili-platform-product.patch供交接。

## 主线程服务合同补充与412回归

- 主线程确认服务module最终返回video_url=true及video_url_platforms=[bilibili]，本实现已覆盖。服务端某原BV请求412、新公开短视频交叉验证由主线程进行；App代理未访问真实链接，不保存真实BV或宣称B站一定成功。
- 页面“支持B站”仅描述范围，integrationJson保留后端真实安全错误消息。追加离线用例：GET有效B站能力后模拟一次POST被412拒绝，断言原message/status可见、只有一次POST且不重放。
- 新增用例后定向integrationRelease.test.ts：28/28通过，0.596s；之前全量124suite1134test通过，此后只加测试不改产品逻辑，不将其计为已跑全量1135。TypeScript此前通过。
- 文件交接：产品4源码；测试4文件（含新intakeCapabilities）；文档/档案6文件。未commit/push、未改root；主代理负责部署与打包。

## 审查更正：总开关必须优先（当前有效合同）

此前“false+显式bilibili允许”是本代理错误解释，以上历史记录保留并由本节替代：allowsBilibili和isVideoUrlAllowed首先检查video_url!==true即返回false；平台列表只能缩小已启用范围，不能越过总开关。普通网页在调用端与视频单独分类，不被视频总开关误阻断。

加入helper、UI、submitIntake和production API反例，false+[bilibili]均阻断B站、无unknown新标记/无POST；普通网页仍可提交。定向5suite97tests通过，2.603s；tsc exit0。此前全量1134是更正前证据，不作为修复后全量结果。本次已冻结product/UI，尚未commit。412按用户澄清仅是实际runtime请求失败，不代表B站视频失效；服务支持范围不代表实时网络可用性。

后续设备直连下载方案仅只读审查，不改当前产品流程、不发模型/ASR/真实网络、不部署。

## 本轮最小收尾：只读来源预检

- 用户取消设备native下载扩展，本轮没有任何native新文件或代码修改。
- ContentServiceCapabilities新增可选video_source_preflight?:1；存在但不是整数1在capabilities核验拒绝，缺字段保持旧设备合同。仅submitSource新URL分支、视频总开关/平台已允许且B站或b23.tv时，在pending和operation生成前POST /api/content-service/video-source {url}（60000ms）；不使用返回值改写原URL，不携带operation头。读取成功后仍按原路径生成唯一operation及提交。
- return/recover既有分支逐字未动，普通网页与文件不增加该预检。源站412由后端安全detail传播，不推断视频失效，不自动重放生成。
- Red：实现前新拒绝/顺序测试3项失败，实际旧实现直接generate且先持久unknown，吻合目标缺失；28项已通过。Green：实现及optional1验证后5suite108tests通过、tsc exit0；随后补2项既有return/recover反例并做最终全量，结果待追加。
- 验证由App网络守卫运行，所有API均mock；没有真实来源/ASR/LLM、身份映射、任务创建或部署调用。

### 最终冻结验证

- 最终全量：124 suites / 1153 tests全部通过，21.19s，Node192单进程+offline-network守卫；包含总开关优先修复、422/502不落operation、新来源成功顺序、旧cap/普通网页跳过及既有return/recover不变。tsc exit0，Windows core.whitespace=cr-at-eol diff --check exit0。
- 冻结源码仍4文件：intakeCapabilities.ts/integration.ts/noteIntake.ts/NoteIntakeScreen.tsx；没有native新文件。所有改动未提交，HEAD保持a9174e4，未写原App或root。
