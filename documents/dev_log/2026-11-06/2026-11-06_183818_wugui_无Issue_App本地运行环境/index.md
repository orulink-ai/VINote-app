# VINote App 本地运行环境

## 基本信息
- 建档作者：wugui；时区：Asia/Shanghai
- 需求：了解 App 源码，配置 D:\tool 下的运行环境并更新环境变量。
- 分支：codex/meeting-asr-20261102；类型：本机配置；状态：进行中。

## 目标和范围
- 配置 React Native / Android 开发依赖并验证，保留既有代码和部署设置。
- 不涉及发布、签名或修改用户数据。

## 当前进展与决策
- 使用校验过 SHA-256 的 Node 22.22.3，保存在 D:\tool\nodejs22。
- 复用 D:\tool 中的 Android SDK、NDK、JDK 17；Gradle 项目要求 Java 21，由 Gradle 下载到 D:\tool\gradle\jdks。
- 用户环境配置 JAVA_HOME、ANDROID_HOME、ANDROID_SDK_ROOT、GRADLE_USER_HOME 和 PATH；D:\tool\vinote-app-env.ps1 可为当前 PowerShell 会话设置确定的工具优先级。
- TypeScript、部署配置校验、17 项脚本测试通过；Android 调试构建进行中。
- ADB 检测到设备但尚未获得 USB 调试授权，尚未进行真机运行。

## 验证说明
- 本次为本机环境配置，不适用先编写产品功能测试的 TDD；采用实际工具版本、项目配置和构建检查。
- 未提交、未合并或发布。

## 后续验证记录
- Metro 在 8089 端口启动，`/status` 返回 `packager-status:running`，检查后已停止测试服务。
- 手机已授权 ADB；检测到既有 `com.vinoteapp.dev`，未卸载或清除数据。
- 首次 `assembleDebug -PvinoteChannel=public` 下载大量依赖，长时间停留在依赖准备阶段，本次主动终止；没有得到 APK，不构成 Android 构建通过。构建时出现 Kotlin 2.2.10 与 KSP 2.2.0 的兼容警告，是否影响构建尚未证实。
- 用户 PATH 包含新工具，但系统级 PATH 可能优先于用户 PATH；执行 `. D:\tool\vinote-app-env.ps1` 可确保当前终端优先使用 Node 22。
