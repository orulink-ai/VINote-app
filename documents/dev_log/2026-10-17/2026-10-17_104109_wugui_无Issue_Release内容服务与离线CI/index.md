# Release 内容服务配置与轻量离线 CI

- 作者 wugui；参与者 Codex；2026-10-17 Asia/Shanghai；分支 codex/app-meeting-notes-feishu；PR10。
- 状态：进行中；本地修改，尚未提交。
- 用户授权：仅 App 交付目录设计/实现/离线测试及中文追加 commit，不推送、不云端/ASR调用、不改原 dev checkout或设备数据。

## 背景与目标

Release generationBaseUrl 写死为空，构建无隐藏地址注入。新增独立配置，真实 URL/部署由主线程提供；不能借用 VILab 或 Feishu-only 入口。Debug USB loopback 保持。

## 调查

GitHub 只读查询 PR10 statusCheckRollup=[]；仓库 Actions workflows total_count=0，本地没有 tracked .github workflow。新增 PR 轻量离线检查，不宣称已在 GitHub 执行。

## TDD 与验证

待追加实际 Red/Green 结果；不构建原生包。

## 关联历史

补充 [Release 旧地址复核](../2026-10-17_101000_wugui_无Issue_iOS说话人分窗补齐/index.md)，仅替代写死空地址机制；真实内容服务仍待部署，不影响此前 iOS 未验收边界。

## 2026-10-17 10:52 Asia/Shanghai｜wugui / Codex

- 状态：产品实现、源码审查及本地离线验证完成；本次提交前记录。用户已明确授权追加中文commit及push触发CI；服务部署、原生内置JS构建和无推理手机验收由主线程负责，仍pending。
- 决策更新：初期准备禁止复用integration入口；主线程明确新VINOTE_CONTENT_CLOUD runtime与Feishu共用/vinote-api，改为显式URL加authenticated capabilities证明内容角色，不从URL推断。public与selected JSON均配置该URL，test模板空；普通Metro始终loopback。
- 最终capabilities：content_service_protocol严格1、generation严格true、sync严格false、max_upload_bytes正安全整数、video_url布尔；reason仅诊断。旧protocol/enabled字段不兼容。默认服务上传预算134217728字节，PDF/DOCX还取20MiB较小值；实测FS.stat而非信任元数据。新来源预检/预算/视频限制失败不写unknown提交，不POST。
- 只读就绪检查接到NoteIntakeScreen，复用AsyncState、live region/alert与44dp按钮；失败可重新检查，输入/原件保留，超限或明确视频链接禁止生成。video_url=false限制不可替代后端独立出站隔离。Root本地8900此前没有caps，需Popper补受generation_auth保护的统一只读接口；客户端不绕过此门槛。
- Release产品请求均做能力预检，Feishu/MCP独立；固定task图片合同沿用现有ContentImage：账号Bearer、PNG/JPEG/WebP、5MiB、临时缓存清理，无新增workspace上传或任意原媒体读取。详见docs/content-service.md路由表。
- standalone源码检查：既有MainApplication用BuildConfig.VINOTE_STANDALONE关闭dev support；项目standalone清空debuggableVariants，锁定RN插件TaskConfiguration.kt设置devEnabled=false。新增内容配置无nativeAPI；不将源码检查当内置包验收。
- PR10 GitHub只读调查：statusCheckRollup=[]，workflow总数0，Actions enabled=true/allowed_actions=all。新增App offline checks，PR/main/manual触发，仅锁定依赖安装、配置、Node脚本、TypeScript、单worker Jest；测试进程禁fetch/DNS/socket真实网络。未构建Android/iOS、不下载speaker模型。推送后的CI状态另行记录。

### TDD/验证

1. Red：node --test scripts/generation-deployment.test.cjs初始2项失败，旧校验既不要求Release内容地址，也不拦误用VILab。之后主线程修订允许integration共址，保留角色预检。
2. Green：node --require ./scripts/offline-network.cjs --test scripts/*.test.cjs：11 passed，exit0。
3. node scripts/validate-deployment.cjs --require-generation：exit0；仅检查现有selected/public/test配置，无通道切换或网络访问。
4. node --max-old-space-size=256 node_modules/typescript/bin/tsc --noEmit：最终exit0。
5. 最终全量node --require ./scripts/offline-network.cjs --max-old-space-size=192 node_modules/jest/bin/jest.js --runInBand --watch=false --silent：123 suites/1110 tests passed，41.903s，exit0。此前1102项是追加视频/页面边界测试前的中间结果，不重复累加。定向5suite97项通过后最终全量包含所有测试。
6. git -c core.whitespace=cr-at-eol diff --check：exit0；Windows LF/CRLF转换警告不等于实质空白错误，不重排无关文件。
7. 原App回拷核对：基线f5379ff537135f4f70982896a98fa138d237ffd4；13个产品/配置文件，10个现有文件规范化CRLF后与基线相同，3个新文件不存在，无冲突。原始目标snapshot SHA、源SHA及精确patch写入忽略的artifacts/delivery-prep，仅供主线程回拷前再次核验，不提交私人工作目录清单。没有写原App或根后端。

### 范围及遗留

- 完全离线，无真实cloud/ASR/LLM/生成POST、无设备/服务重启/卸载清数据。Root部署仍pending，本轮不声称所有链接/上传生成成功。
- 公网视频URL尚未启用；普通网页/PDF/Word/媒体上传只说明服务契约，未做端到端生成验收。
- iOS未构建/设备验收；原生FS下载/TLS/重定向行为待包验收。
- 主线程后续原App只按snapshot SHA核验后应用产品patch；原生缓存构建与compatible debug签名覆盖安装独立验收。

### 后续变更

待追加实际CI/服务部署/无推理手机证据，不将其混入以上离线结果。

## 2026-10-17 10:55 Asia/Shanghai｜wugui / Codex｜CI跨时区测试修正

- 产品源码已冻结于1363311并已push；未修改任何产品/配置文件。
- 首次GitHub run 38996608865：配置、脚本、TypeScript通过；Jest为122suite/1109test通过、1项失败。既有recordingTitle.test.ts把输入+08时区的10月12日写死，而产品按设备当地时间格式化，UTC runner正确得到10月11日22:58。
- Red：本机显式TZ=UTC定向18项中复现同一1项失败。Green：断言改用输入时间在当前时区的Intl日历日期；分别TZ=UTC和Asia/Shanghai定向18/18通过，网络守卫开启。保留原日期来源、主题和未知时间断言，不固定CI时区掩盖问题。
- 本次仅测试与本档案追加中文commit并push，第二次GitHub实际结果在交接报告登记，不重跑无新变化的产品测试或扩大功能。
