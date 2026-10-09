# App 运行、打包与部署

[English](build-and-deployment.en.md) · [功能与限制](../README.md)

## 环境与源码运行

Node >=22.11；`npm ci` 使用锁文件安装。Android 使用 SDK/Build Tools 36.0.0、NDK 27.1.12297006，最低 API 24；JDK 21 可使用 Android Studio JBR。通过 `ANDROID_HOME` 或不提交的 `android/local.properties` 指定 SDK，通过 `JAVA_HOME` 指定 JDK，不硬编码个人电脑路径。已有环境无需重复安装。

本机已知 SDK 在 `D:/tool/sdk/android`。若 JDK 报 `Unable to establish loopback connection`，仅在受影响机器上创建 `D:/tmp` 并设置 `JAVA_TOOL_OPTIONS=-Djdk.net.unixdomain.tmpdir=D:/tmp -Djava.io.tmpdir=D:/tmp`，不是所有机器的必需参数。

四个 Android 命令见下表；Debug 命令会启动 Metro 并安装到已连接设备。手机授权 USB 或无线调试后可用 `adb devices` 检查；需要转发时执行 `adb reverse tcp:8081 tcp:8081`。Debug 模式需要 Metro，不能作为离线演示包。单独执行 `npm start` 时沿用上次选中的通道；先用 `npm run config:test` 或 `npm run config:public` 切换。

## Android 包

VINote Test 使用内网 VILab http://192.168.1.143:9876；VINote 使用公网 VILab https://api.orulink.ai。脚本自动选择对应配置，两版可同时安装。账号认证仍使用同一 Supabase 项目，公网包不使用内网账号代理。

npm 脚本会自动选择对应配置。直接运行 Gradle 前需先选择通道，并传入 `-PvinoteChannel=test` 或 `-PvinoteChannel=public`；公网 Debug 必须显式传入 public。Babel 也执行配置校验。切换通道时请顺序构建，不要同时运行两个不同通道的 Metro/Gradle 任务。

| 命令 | 产物 | 用途 |
| --- | --- | --- |
| `npm run android:test:debug` | VINote Test，`com.vinoteapp.test` | 内网源码调试，连接 Metro |
| `npm run android:test:apk` | `artifacts/android/vinote-test.apk` | 内网独立 APK，内置 JS，调试签名 |
| `npm run android:vinote:debug` | VINote Dev，`com.vinoteapp.dev` | 公网源码调试，连接 Metro；独立包名保护正式版数据 |
| `npm run android:vinote:apk` | `artifacts/android/vinote.apk` | 公网正式 APK，使用发布签名 |
| `npm run android:bundle` | `android/app/build/outputs/bundle/release/app-release.aab` | 自有签名的商店上传候选 AAB，不能直接 adb 安装 |

`android:standalone`、`android:release` 保留为旧命令别名。Debug 命令可通过 `-- --device <设备序列号>` 指定手机。两个 Debug 通道共用 `app-debug.apk` 路径，后构建的包会覆盖该文件；请以脚本名和 APK 实际包名为准。公网 Debug 使用调试签名和独立 `com.vinoteapp.dev`，不能覆盖已签名的 `com.vinoteapp`，也不共享本机录音。

脚本调用项目 Gradle wrapper；Windows 使用 `cmd.exe /d /c gradlew.bat`，其他平台使用 `./gradlew`。默认架构遵循 `android/gradle.properties`，无需为当前手机把全项目固定为单一架构。

正式构建必须在环境中提供以下四项，缺失时直接失败，不回退调试证书：

- `VINOTE_ANDROID_KEYSTORE`：已有签名密钥库的绝对路径。
- `VINOTE_ANDROID_STORE_PASSWORD`：密钥库密码。
- `VINOTE_ANDROID_KEY_ALIAS`：签名别名。
- `VINOTE_ANDROID_KEY_PASSWORD`：签名密钥密码。

通过本机安全环境或 CI 密钥注入，不写入 Git、命令日志或部署 JSON。同一应用后续升级必须使用兼容签名及递增 versionCode；调试签名与正式签名不能直接互相覆盖。不要为覆盖安装直接卸载含重要录音的应用，应先导出。Release 构建通过不等于商店审核通过。

安装验收包：`adb -s <序列号> install -r artifacts/android/vinote-test.apk`，再运行 `adb -s <序列号> shell am start -n com.vinoteapp.test/com.vinoteapp.MainActivity`。独立包不依赖数据线或 Metro，但仍有部署网络依赖。

## iOS

在 Mac 上执行 `npm ci`、`bundle install`、`cd ios && bundle exec pod install`，再打开 `ios/VINoteApp.xcworkspace`。开发可在仓库根目录执行 `npm run ios` 并运行 Metro；真机需要在 Xcode 中选择开发团队和签名配置。

正式版归档前执行 `npm run config:public` 和 `npm run config:check`；测试版归档前执行 `npm run config:test` 和 `npm run config:check`，在 Xcode 选择真实设备/通用 iOS 设备、Release 和 Product → Archive，再通过 Organizer 按证书配置导出或分发。没有在 Windows 生成可安装 IPA 的脚本；尚无已验证的 iOS Release 产物。音频、导入、后台录音、局域网权限、ATS 和登录直连需在 Mac/iPhone 上验收，不能根据 Android 结果承诺可用。

## 部署配置与公网

- `channel`：`lan` 或 `public`。
- `apiBaseUrl`：VILab 服务 Origin，不含路径、查询、凭证；客户端追加各 API 路径。
- `authBaseUrl`：HTTPS 账号入口 Origin，须保留 `/auth/v1`、Supabase 项目及认证行为；项目公开 publishable key 位于 `src/config/env.ts`，不能替换为 service_role 密钥。
- `accountProxyHost` / `accountProxyPort`：Android 账号 CONNECT 出口；端口为 1–65535 的整数。公网通道主机必须为空字符串，端口仍保留有效整数。

`lan` 允许 Android 明文网络以访问当前 HTTP 服务；`public` 禁用 Android 明文流量。公网校验要求 HTTPS DNS 域名，拒绝 IP 字面量、单标签主机及已知保留域名。**不执行 DNS 解析，不检测域名是否解析到私网，也不替代外网端到端验收。**

公网 VILab 已配置 HTTPS 域名。仍需由部署方确认 DNS/证书、长请求超时和上传大小，并在蜂窝网络验收登录、模型列表、长音频、超时与重试。测试包仅适用于可访问内网服务的网络。

## 检查与数据保护

`npm run config:check`、`npm run test:scripts`、`npm test -- --runInBand`、`npm run typecheck` 分别验证配置、脚本回归、应用单测及类型。原生构建和真机验收是独立检查。后台采集与前台生成不是同一能力。不要提交 APK、音频、转写、令牌、私钥或私人截图。

Gradle 插件还需要可发现的 JDK 17 工具链。若已安装但未被发现，设置用户级 ~/.gradle/gradle.properties 的 org.gradle.java.installations.paths 指向该安装目录；无需重复下载 JDK。审查时 standalone Gradle 任务图检查通过，正式无签名构建被拒绝；未重新产出 APK 或验证生产签名包。
