# App 0.1.4 发布收尾

- 作者：wugui；参与者：Codex；日期：2026-10-17 Asia/Shanghai。
- 分支：codex/release-app-0.1.4；基线 origin/main 407fd76。
- 状态：源码修改和离线验证完成，准备中文提交与 PR；未构建、部署或合并。
- 授权：仅本发布工作区配置、版本、离线测试、文档、提交和 PR；禁止实际构建、模型调用和改动 live。

## 背景与决策

用户指定版本 0.1.4，Android versionCode 保持 9，高于 0.1.3 的 8；iOS 统一营销版本并保留独立递增 build 5。LAN 包采用 LAN 模型直连加公网账号、内容与飞书；链接/上传笔记由公网内容后端执行，不声称使用 LAN 模型。模型 ID 必须与内容后端目录兼容，不自动换模型。
所有独立 APK/AAB 均要求显式内容与飞书地址；Metro 保留开发兼容。直接 Gradle standalone 也须校验，Release 仍限定 public 与正式签名。

## 历史关联

补充 [Release 内容服务与离线 CI](../2026-10-17_104109_wugui_无Issue_Release内容服务与离线CI/index.md)，替代其中 test 模板留空及仅 Release 强制校验的配置决策，历史验证不改写。

## 验证

待记录修改前失败与修改后结果；无原生包构建、设备或付费服务验收。

## TDD 与最终审核

- Red：先添加版本/混合配置/独立包门禁测试，7 项中 4 项按预期失败：旧版本、LAN 空地址、无独立包门禁、缺失 integration 未拒绝。
- Green：`node --require ./scripts/offline-network.cjs --test scripts/*.test.cjs`，17 passed。含所有独立入口/别名、空内容或集成地址时零原生调用、直接 Gradle 门禁源码合同、版本与锁文件/iOS/manifest 合同。
- `node --require ./scripts/offline-network.cjs --max-old-space-size=256 node_modules/typescript/bin/tsc --noEmit`：exit 0。
- 单 worker Jest，禁网、缓存仅在本工作区 artifacts：`integrationRelease.test.ts` 与 `noteIntake.test.ts`，2 suites / 77 passed。
- `node --require ./scripts/offline-network.cjs scripts/validate-deployment.cjs --require-generation --require-integration --require-public`：exit 0，未切换 selected 配置。
- Android manifest 不硬编码版本，继承 Gradle；iOS Info.plist 引用 MARKETING_VERSION / CURRENT_PROJECT_VERSION，Debug/Release 均核验。iOS build 5 是独立序列，不与 Android versionCode 9 强行相等。锁文件仅修改根包版本，不改依赖版本。
- Diff 仅限版本、LAN 模板、构建配置门禁、离线测试、相关说明及双向档案链接。旧 0.2.0 说明保留并标注历史，0.1.4 新说明为当前依据。无大重构。
- 初次 diff --check 将仓库既存 CRLF 当成尾空白；最终使用 cr-at-eol 规则审核，不为本发布重写整份锁文件换行。
- 未运行 Gradle、Metro、原生编译或模型准备；未调用 ASR/LLM；未修改工作区之外的 live 配置、服务或依赖目录。GitHub CI 在 PR 创建后另行核验；不把本地测试当作新安装包验收。


## 后续修正

[App笔记模型来源修复](../2026-10-17_180000_wugui_无Issue_App笔记模型来源修复/index.md) 替代链接/上传经公网worker推理的混合方案；账号和飞书继续共享，所有新模型请求由App固定Origin直连。保留0.1.4/code9及guard，不改本档历史验证。
