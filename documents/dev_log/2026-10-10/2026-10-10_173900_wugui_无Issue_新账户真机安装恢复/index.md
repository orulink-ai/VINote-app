# 新账户真机安装恢复

- 创建时间：2026-10-10 17:39 Asia/Shanghai
- 作者：wugui；参与者：Codex
- 分支：codex/unified-meeting-account-upgrade
- 状态：本地修改已验证；准备提交 PR

## 背景与目标

延续用户分享的“app组件优化”会话。最新未完成事项为桌面已登录新 Supabase、手机仍登录失败。恢复公网 Debug 安装与桌面源码运行，保留录音、旧项目服务端认证支持，不实施工作台全面升级。

## 调查与变更

- USB 设备 TNA-AN00 在线，原 com.vinoteapp.dev 最后安装时间为当天 11:47；原生包早于新账户切换。不能将旧包失败直接判定为新账号服务故障。
- Gradle 堆栈显示 PipeImpl / UnixDomainSockets.connect 报 Invalid argument。将本次进程 TEMP、TMP 和 java.io.tmpdir 指向 D:/projects/VINote/data/java-tmp 后构建成功；无需关闭证书校验或修改系统网络。
- 使用 public、standalone、arm64-v8a 构建 Debug，首次构建 1 分 6 秒完成，adb install -r 返回 Success，17:42:39 更新安装时间并启动 MainActivity。保留应用数据。
- 现有旧会话清理在模块导入时直接调用原生 Keychain，同步异常不能由返回 Promise 的 catch 捕获。改为 Promise.then 内执行，保留凭证操作顺序和旧会话清理行为。
- 回归测试原有两个 suite 失败；补全 Keychain 原生模拟并修正双服务退出断言。

## 验证

- npm run config:check：通过。
- npm run typecheck：通过。
- npm test -- --runInBand：27 suites、113 tests 全部通过。上述测试在真实回归失败之后修复，不声称新增测试先行。
- 桌面 node scripts/dev.mjs --target desktop --environment public 已启动 API、Vite、Tauri；auth/session、notes、model-profiles 等请求返回 200。
- 用户重启后，最终构建再次覆盖安装到 USB 设备 ABTMUT1C06010498，最后安装时间为 17:46:30；MainActivity 启动成功。8900、3100 端口持续监听。当前过滤的 ReactNativeJS/AndroidRuntime 错误日志为空；这不代表真实登录已通过。
- git diff --check：通过，仅提示 jest.setup.js 的工作区换行转换。
- 手机请求成功和真实登录仍待用户操作；尚未确认新项目账号登录及模型链路完成。没有提交、推送、发布新版本。

## 验收与后续

- 已确认新账户公网包覆盖安装并启动。
- 请求用户在手机使用桌面已成功的新账号登录，不获取密码。若失败采集脱敏网络错误继续调查。
- 构建日志保存在忽略目录 data/account-debug-build.log；不得提交设备日志、凭证和原录音。

## 2026-10-10 提交前记录｜wugui / Codex

- 用户确认新版手机使用新账号登录成功，并授权提交、推送、创建中文 PR 及正常合并。
- 本次提交包含 Keychain 初始化异常处理、开发模式网络诊断、测试和本档案；此前账户配置与旧会话清理提交一并进入 PR。
- 手机补丁版本更新为 0.1.3，Android versionCode 更新为 8；已安装且登录成功的验证包为版本更新前的 0.1.2 Debug。
- 验证范围为真实登录、113 项自动化测试、类型检查及公网 Debug 构建；不声称会议生成已完成端到端验证。
