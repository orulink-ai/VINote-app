# Android设备保存B站音频

- 作者wugui，参与者Codex；2026-10-17 Asia/Shanghai；本轮仅App交付repo，起点8975515。用户授权实现，禁止commit/push、root修改、真实ASR/LLM；主代理负责review/build/actual。
- 已读AGENTS、开发档案规范及先前B站能力/预检档案。UI沿用已读ui-skills-root和RN最小上下文。
- 独立显式设备保存，不自动回退、不替换旧failed/unknown，不在下载中调用模型。复用MeetingFiles桥接，专用无Cookie/Bearer/代理客户端；逐hop HTTPS/host/public DNS和原生字节上限。iOS未实现即明确禁用。
- 参考主线程已实现的bilibili_source_service.py公开接口/分P/AAC选择合同（只读参考，没有写root）。原版RNFS重定向和JS进度不能保证原生硬上限，故自有受限native downloader加RNFS账号文件登记，不修改node_modules。
- 状态：实现中，尚未验证/提交。

## 实际实现

- BilibiliDownloadPolicy.kt / BilibiliAudioDownloader.kt：纯策略与专用原生HTTP客户端，沿用已成功server模块的view/playurl/分P/AAC规则。仅App cache固定job路径，原生8192B流式、128MiB资源上限、JSON2MiB/深度32、4跳、HTTPS/角色host/public DNS、NoProxy/NoCookies/无授权头/无自动redirect或连接重试。HTTP2保持OkHttp正常协商，不因412切换代理/凭证/接口或绕验证码。
- MeetingFiles.kt：protocol1 start/cancel/release桥接、单下载、身份取消原子标记、Call.cancel、throttled事件、MediaExtractor校验、part发布及cleanup。native不接受任意输出URI，release只接受固定jobID；旧cache冲突拒绝不覆盖不清理。
- bilibiliDownload.ts：lease绑定owner+identityEpoch+jobID、前台开始/后台取消/身份切换取消、结果字段和byte预算核验、finally等待native Promise后清理；没有导入accessToken，不传header/token给native。
- localFiles.registerBilibiliFile：仅接受file://<RNFS cache>/bilibili-<该job>.m4a；实际stat核验、固定当前owner/files路径，guard贯穿binary move与meta原子提交；取消前已完成登记保留原账号，否则清理未发布文件。purpose=note/source=bilibili，不移录音库。
- 文件元数据保留原/规范URL、BV/aid/cid/page/duration和稳定operation；保存到Note.bilibili_source，文件Sheet和笔记来源Disclosure可见，未保存CDN签名URL。
- NoteIntakeScreen独立显式“从 B站保存音频”带流量确认、实际字节进度和取消；已有task/operation/uncertain时不提供回退动作。完成只切到已保存文件，不自动调用上传或模型；iOS和旧Android包禁用。
- 首次public media upload沿用既有接口、源模型逻辑和submission持久化，使用已下载文件的唯一operation；该文件已有任何原上传关联时仅GET原source-request恢复，不换新operation、不重试旧ASR。未修改模型默认值或加入fallback。

## 真实离线证据

1. python scripts/check-bilibili-native-offline.py：最后exit0。Kotlin编译器heap256MiB，使用现有Kotlin2.2.10/RN0.87.1/Android36/OkHttp4.9.2缓存编译实际三份production Kotlin及测试，未运行Gradle或下载。JVM96MiB执行真实共用policy与实际private hop loop（反射注入合成Interceptor，无socket/DNS）。覆盖URL/编码/分P/角色host/public地址、字节预算和短读、取消检查、JSON深度，以及专用client配置、无Cookie/Authorization、允许/拒绝redirect、HTTP412不重放、取消后零请求。合成HTTP2响应不是实际ALPN/联网验收。
2. node --max-old-space-size=256 node_modules/typescript/bin/tsc --noEmit：exit0。
3. 最终node --require ./scripts/offline-network.cjs --max-old-space-size=192 node_modules/jest/bin/jest.js --runInBand --watch=false --silent：126suite1167tests全部通过，40.153s，exit0；离线守卫启用，单worker。新增device controller7项、文件/笔记来源4项、页面确认/旧任务无自动fallback、未知上传原operation GET-only等均包含其中。
4. git -c core.whitespace=cr-at-eol diff --check：exit0；Windows换行不扩大重排。

## 失败与修正记录

- 首次native编译Dns lambda不符合缓存OkHttp4.9.2接口，改为显式Dns object后编译通过。TS首次native事件Object字段类型和测试CAS参数类型错误均已修正；没有降低strict。
- 文件编辑来源保留用例首次错误传了string baseline，正确使用既有CAS对象后通过。后台取消测试首次用DeviceEventEmitter触发Jest已mock的AppState无效；改为调用实际注册的change listener，确认cancel后迟到结果不登记。不是以改生产行为迁就测试。

## 冻结与尚未验收

- 当前仅本地修改，无commit/push；起点8975515由主线程此前提交，本代理本轮未操作Git提交。未写原App运行目录或root源码。
- 没有真实B站下载/ASR/LLM、设备、proxy/USB/reverse、部署或APK构建。native compile是API编译证据，不等于React桥接/Android MediaExtractor/JSON响应/后台取消或真实DNS/TLS/CDN实机通过。iOS明确未实现。
- 主线程负责review、原目录SHA核验回拷、public standalone缓存构建和新样本先下载验收，再决定单次首次推理；不复制桌面成功为App证据，不声称云机412已解决。具体真实样本/账号/设备ID不写入仓库。
- 本轮所有编译/测试均已结束；未启动Gradle daemon，后续不追加无新原因的全量测试，与根frontend单worker测试错开。

## 2026-10-17 HTTP403 阶段诊断（wugui）

主线程报告新Android包下载失败HTTP403，无generation/ASR；电脑同视频metadata成功，不能判定视频失效。静态对照确认native此前Mobile UA与成功Python桌面Chrome UA不同，Referer/identity及view/playurl参数一致。对齐UA仅消除请求差异，不证明403根因，也不证明新包成功。

新增VINoteBilibili Log.w仅固定stage(short/view/playurl/audio)、HTTPcode和protocol，不传URL/CDN/IP/token/响应内容/异常。用户HTTP错误区分来源与音轨。没有Cookie/代理/重试/协议强制回退。

定向离线检查通过：实际三份Kotlin生产源码编译；共用policy；四阶段403日志精确白名单断言、412单请求不重放、header/API构造、取消及重定向；Python AST静态比较UA/Referer/identity与playurl参数一致。编译256MiB、JVM96MiB；未运行Gradle、未联网/模型调用、未动Metro或设备。TS未变，本次不重复Jest/tsc。源码冻结交主线程copy/build，无commit/push。

## 2026-10-17 12:44:06 Asia/Shanghai｜wugui｜设备下载实际成功与模型选择修复

### 主线程报告的实际证据（本代理未操作设备）

- 初版APK下载公开40秒样本HTTP403，未创建generation，零ASR；电脑同视频仅metadata安全resolve成功，不能判定视频失效。
- APK366a对齐Python UA并加入脱敏阶段日志后，设备实际下载成功；原文件进入笔记资料，BV/分P可见。仅这次成功不能证明所有403的根因，也不能证明云机412消失。
- 用户随后明确点击生成一次，返回所选云端模型不可用；主线程只读确认原操作仅reserved、task folder不存在，在prepare_models阶段失败，无ASR。真实operation/task/账号ID不写档案。
- 主线程在App确认ASR仍为Aliyun paraformer-realtime-v2，将不可用旧LLM改选deepseek-v4.1-flash并确认。这是显式选择，不允许后续自动换模型，也不修改旧reserved快照。

### 源码定位与本轮修复

- 证实noteIntake未loadSelection/loadModels，也未发送asr_model/model_name。读取root当前cloud_content.py确认upload从multipart各字符串字段构建ContentOptions；不是options JSON。只读root，未改root。模型不可用也有旧LLM选择因素，不能把全部失败归因于漏字段。
- 新operation前复制当前选择，loadModels(true)按modelEligible校验所需模型，账号guard后传递并持久化modelSelection；URL JSON顶层字段，upload独立form字段。网页/文档/逐字稿仅LLM，音视频另核验ASR。不写死模型，不自动fallback。
- 既有operation/task与下载文件association的恢复先返回，不读取新选择来补改旧请求，不补POST。旧failed/reserved/accepted不自动换op或重跑。
- reserved标题改为提交待核验/尚未确认任务启动，不显示处理中进度圈；原核验GET返回reserved即停，不查询不存在task。明确确认整理另一份内容后先保留source-request档案及association再清intake；新内容须另行点击生成。保留档案不等于新增完整历史列表。
- 本轮产品仅src/lib/noteIntake.ts、src/screens/NoteIntakeScreen.tsx及两个关联测试；无native变更。原仓两源码由主线程复制，本代理未写原运行仓库、未构建或commit/push。

### 验证与纠正记录

- 修复后tsc --noEmit通过。定向Jest两套60项通过，进程网络守卫开启，heap512/runInBand。新增模型校验/冻结与传递、不可用前置失败、文本不要求ASR、reserved退出保留档案关联、新slot保护、只GET无generation等用例。
- 首轮定向58通过/2失败：测试错误假定FormData._parts，另一个计数重复包含RN包装节点；只修测试断言为实际FormData.get与存在性断言，未改产品迁就断言，二轮60全部通过。属于实现后补测，不倒写成严格先测TDD。
- Windows换行按git -c core.whitespace=cr-at-eol diff --check通过；不为既有CRLF重排。复制前原文件SHA及ready SHA记录在忽略制品artifacts/delivery-prep/intake-model-selection-ready.json，非真实验收证明。
- 早先全量126套1167项通过是新增模型imports之前的版本。当前只60项，不能作为全量充分证据。主线程已要求全量回归，本代理遵照构建互斥：当前原仓单worker构建中，暂停所有Jest/tsc，不动src。待主线程明确build done后执行heap512单worker全量Jest；不自行Gradle。

### 当前状态与限制

- 文档区分源码/离线测试/主线程设备与服务器证据。设备下载及来源保存已在该样本成功，但修复版公网上传→ASR→LLM→正文保存重开尚未验收，不能宣称App完整链路成功；桌面成功不替代App证据。iOS仍无native下载。
- 后续只响应主线程实测与构建结束通知；不重试旧receipt、不新增真实模型调用、不代理/cookies/绕验证码。

## 2026-10-17 12:45:50 Asia/Shanghai｜wugui｜构建后全量离线回归

主线程明确build done，新包APK51111baf构建成功；本代理随后串行运行node --require ./scripts/offline-network.cjs --max-old-space-size=512 node_modules/jest/bin/jest.js --runInBand --watch=false --silent。126套1175项全部通过，28.258秒、退出码0。日志：artifacts/delivery-prep/bilibili-selection-jest-full.log。未修改src、未运行Gradle/tsc或真实网络/模型调用。当前App实机生成验收仍由主线程进行，不能将全量离线通过记为真实ASR/LLM或完整生成成功。

## 2026-10-17 12:48:51 Asia/Shanghai｜wugui｜B站主入口闭环

复审发现Android主生成按钮仍提交公网URL，设备下载仅次要入口，不能用次要下载成功证明正常主入口可用。最小修正NoteIntakeScreen：fresh B站URL且native可用时，主按钮读取B站内容，复用下载确认；移除重复次要按钮。确认仅设备保存，不POST URL或模型；保存完成切file，用户另点生成才调用现有文件提交。native路径要求service ready，但不受远端video_url开关错误禁用；iOS提示导入文件并阻止B站URL提交。unknown/reserved/accepted原查询边界不变，无自动fallback。noteIntake.ts和native未改。

关联UI测试覆盖remote video false仍可设备主入口、无重复按钮、确认前无下载、下载后无生成、另点才提交file、service失败不下载、iOS不URL提交、既有task不下载。tsc通过，定向两套62项通过；随后heap512/runInBand离线全量126套1177项通过，24.646秒、退出码0。日志artifacts/delivery-prep/bilibili-primary-jest-full.log；新两src SHA与原仓复制guard在bilibili-primary-ready.json。未运行Gradle、设备或网络/模型调用，未commit/push。主线程需复制最新screen后构建实际验收；不宣称新入口实机全链已成功。源码已冻结。

## 2026-10-17 12:57:30 Asia/Shanghai｜wugui｜主线程报告App实际生成及首次保存打开

最终APK db67fca已安装；主按钮读取公开40秒样本成功。用户明确新生成独立operation/task，accepted后实际success，transcript/result/note.md存在。实际冻结asr:6:aliyun:22:paraformer-realtime-v2与deepseek-v4.1-flash，未自动fallback。App已保存并打开正文，显示保存2026/10/17 12:55:38。真实operation/task/账号ID不入文档。

新成功操作与旧失败操作独立；旧模型准备失败操作仍reserved、无task文件夹且零ASR，不补改、不重放。原文件保留。当前只确认下载、明确新生成、推理产物、App保存及首次打开；主线程正在返回/重开/来源核验，此时尚未通过。独立内置JS公网，无USB reverse；不得扩写为已物理拔USB。native真实取消尚未测，iOS无native下载，403全部根因及云机412未因本次设备路径成功而证明解决。

本次仅更新README、下载说明和本journal，未改src或测试、未运行编译/测试/设备/网络/模型，不commit/push。上述实际事实来自主线程，不伪称本代理执行。

## 2026-10-17 12:59:06 Asia/Shanghai｜wugui｜App重开与来源实际核验完成

主线程实际返回笔记列表再点开新笔记成功，展开来源与身份确认公开样本BV13At46PEGQ/第1P/原HTTPS链接正确。rawstatus success，result duration39.520375秒、Markdown742字符、segments1。结合前述主入口读取、明确上传新生成及冻结Aliyun+DeepSeek证据，该样本download→upload→ASR→DeepSeek→save→reopen及来源核验实际成功。原ASR无重跑，旧reserved零ASR操作仍独立，未补改或重放。最终APK db67fca、主线程确认source hash稳定；默认UI仍为独立笔记。

文件库笔记资料正在核验，不提前记通过；native真实取消仍未测，未验证物理拔USB。无USB reverse/内置JS公网不等于物理拔线证据，单样本成功不代表所有来源或云机412根因已解决。本代理只补docs/journal，无源码、测试、设备、云端动作；文档冻结等待交付。

## 2026-10-17 13:01:15 Asia/Shanghai｜wugui｜文件库实际核验与README收尾

主线程报告FileLibrary实际核验成功：笔记资料两份317.8KB M4A，旧reserved和新success原件均保留；新文件详情BV13At46PEGQ/第1P/原链接正确，任务/已保存关联可查看完整新笔记标题。导出/删除入口存在，未执行导出或删除；会议资料5个原录音保持独立。关闭Sheet返回无重复提交。native真实取消仍未测，不提前声明通过。

README仅整理本次新增B站段为当前使用合同+实际验收文档链接，删除代理执行身份与调试流水式叙述，不改旧历史段；详细403、模型选择、reserved、新旧操作与实际推理成功证据保留在本journal和验收文档。当前新task真实生成成功，不将下载阶段无模型调用泛化为整个流程无ASR。仅改三份文档，无src/测试/设备/网络动作，未commit/push。文档再次冻结。
