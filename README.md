# VINote App

[English](README.en.md) · [运行、打包与部署](docs/build-and-deployment.md) · [Android 验收记录](docs/android-device-check-20260923.md)

React Native Community CLI 原生应用，使用 Tamagui 2.7.7；不使用 Expo。Android 已完成部分真机验证；iOS 原生实现已加入源码，但尚未在 macOS/Xcode 编译或 iPhone 验收，不能视为已发布支持。

## 当前架构与功能

- 账号直接连接部署配置中的 Supabase，同桌面端使用同一账号体系；支持邮箱密码登录、验证码注册和邮箱验证码重置密码。访问/刷新令牌保存到系统 Keychain。退出只清除本机凭证，两端可以同时登录。App 不依赖电脑 FastAPI 服务。
- 会议模型直接调用 VILab：`/v1/models`、`/v1/default-models`、`/v1/asr/transcriptions`、`/openai/v1/chat/completions`。模型选择按账号保存在本机；处理开始时固定选择。
- 默认仅录音，不调用 AI；开始前保存草稿，结束先保存原音频，之后可生成纪要。支持修改名称、播放、系统分享/保存文件、确认删除以及系统文件选择器导入音频。
- 默认名称为本地开始时间＋会议录音；生成后可从 AI 主题标题命名，手动名称不覆盖。导入记录使用导入时间，不推断会议实际发生时间。录音标题和纪要标题分别管理。
- 长音频解码为 16kHz 单声道 PCM16 WAV，每段最多 120 秒。逐段保存转写检查点；相同 ASR 模型下手动重试复用已完成段，更换模型重新转写。长文本分层总结并保存检查点；明确的临时网络/502/503/504 错误最多自动重试两次。没有服务端持久任务或任意时刻后台生成保证。
- 纪要支持搜索、Markdown 阅读、改名、删除；删除纪要保留原录音。App 本地纪要标识手机来源；桌面后端另有生成来源字段，二者不是数据同步机制。
- **录音、纪要及处理检查点均按账号保存在手机本机，暂不跨端同步。卸载或清除应用数据会丢失本地内容。重要音频请先导出。**

## 网络与平台边界

`config/deployment.json` 是唯一部署配置入口，打包时内置，无终端用户配置表单。当前为 `lan`：会议服务 `http://192.168.1.143:9876`；Supabase 使用 HTTPS。Android 仅对账号域名使用 `192.168.1.101:7890` CONNECT 出口，必须保证出口在线；iOS 不包含该代理适配。独立 APK 拔掉 USB 后可运行，但云端功能仍要求可访问上述网络。

当前**未实现公网穿透**。切换到 `public` 需要部署方先准备两个稳定的 HTTPS 域名入口、清空账号代理，再打包；域名配置通过不代表 DNS、证书、上游鉴权和大文件上传已验收。

Android 前台麦克风服务用于切换应用及锁屏录音；iOS 配置了后台音频能力。来电、麦克风争用、进程被杀和低磁盘可能中断；中断文件不一定可解码。**转写和纪要生成仍需保持前台**；重新进入录音库可手动重试。说话人区分按需求暂停，当前不提供该能力。

登录来源请求头仅供后台备注，不作为权限依据，不向用户展示。App 直连 Supabase，**尚未写入桌面后端 `auth_login_events`**；不能声称已完成统一跨端登录审计。旧版桌面 JWT 不复用，升级需重新登录；缺少所属账号的旧录音不自动迁移。

## 快速开始

需要 Node >=22.11、npm、Android SDK/NDK、JDK 及平台原生工具；iOS 还需要 macOS/Xcode/CocoaPods。完整说明见[运行与打包](docs/build-and-deployment.md)。

```sh
npm ci
npm run config:check
npm start
# 另一个终端；USB 调试授权后
npm run android
```

源码开发依赖 Metro；若手机不能访问开发机，可执行 `adb reverse tcp:8081 tcp:8081`。独立测试包使用 `npm run android:standalone`，无需 Metro，使用调试签名；正式包使用独立签名流程。

## 验证状态

Android 39 分 10 秒公开长语音样本已完成 20 段转写、失败后续传、分层总结与本机纪要保存，见验收记录。该结果不代表所有会议质量、后台生成或长时间录音完整性已验收。后台录音曾验证服务存活和文件增长，但返回结束后的完整播放仍需补充验收。iOS 编译、签名、账号连通及真机流程待验收。

```sh
npm test -- --runInBand
npm run typecheck
npm run test:scripts
```

父仓库通过 `VINote-app/` Git submodule 固定本仓库提交；先推送 App 提交，再更新父仓库指针。生成物、APK、私人音频、会话和签名凭证不提交。图标源文件在 `assets/branding`；重建脚本 `python scripts/generate-icons.py` 需要 Pillow。
