# 移动端双环境接入

## 基本信息
- 创建时间及时区：2026-10-08 Asia/Shanghai
- 建档作者：wugui（仓库 git config user.name）
- 关联需求：手机 app 测试版接内网 VILab，正式版接公网 VILab，并在真机验收
- 分支：codex/mobile-test-public-vilab
- 状态：进行中；交付状态：本地修改

## 背景与目标
原 app 只有单份内网部署配置。按照桌面端远端 dev 的固定 Origin，测试版使用 http://192.168.1.143:9876，正式版使用 https://api.orulink.ai。构建入口应自动选择环境，测试包与正式包可共存。

## 范围与决策
配置拆为 test/public；Android standalone 使用测试环境，release/bundle 使用公网环境；测试包用独立 applicationId。认证继续复用现有 Supabase 项目，正式版清空内网账号代理。现有 theme.ts 与 HomeScreen.tsx 的未提交界面改动属于其他工作，保留但不纳入本任务提交。

## TDD 与验证
本次先实现配置拆分，之后补脚本回归测试，故不称为先测后写。配置检查、脚本测试、TypeScript 检查及 Jest 13 套件 25 测试通过。公网 Origin 未授权访问返回 401，不能代表业务端到端验收。Gradle 首次受 JDK 环境影响；改用 Android Studio JDK 21 和本机临时目录后重试。无线 adb 已连接 TNA-AN00，等待 APK 构建安装和 UI 检查。远端 VINote-app origin/main 已有本地快照 3bd6e77；本次 fetch 因 GitHub TLS EOF 失败，尚不能证明远端无更新。

## 2026-10-08 验证更新
无线 adb 成功识别设备 TNA-AN00（Android 14）。手机能 ping 通内网 VILab 与公网域名，但这只证明基础网络可达。Android Studio JDK 21 可运行 Gradle，但构建依赖从 Google/Maven 下载时 TLS 握手中断，故未生成新测试 APK；现存 app-debug.apk 的 metadata 仍是旧 applicationId com.vinoteapp，不用于本次验收。已分别尝试直接网络和本机代理，均未解决。手机上的安装、启动和业务操作仍待新包构建成功。测试命令 npm run config:check、npm run test:scripts、npm run typecheck 均通过；上轮 Jest 13 套件 25 项通过。此次补测发生在实现之后。远端 Git fetch 经 HTTPS、OpenSSL、HTTP/1.1 与 SSH 尝试均因连接中断失败；通过 GitHub API 读到 main 最新提交为 3bd6e77，与建分支基线一致。

## 2026-10-08 真机验收更新
使用 Android Studio JDK 21、阿里云 Maven 镜像和短路径原生缓存，成功构建内网 standalone debug 包。APK metadata 为 `com.vinoteapp.test`、版本 `1.1.0`，SHA-256 为 `51917715083F6A7A7EC4F38AAAD34252B4582BE0B8583DABEF8D4F911AD6C0A0`。通过无线 ADB 安装到 TNA-AN00（Android 14），启动后解锁进入登录页，无 VINote 进程崩溃。测试配置使用 `http://192.168.1.143:9876`；该服务 `/health` 返回 200。主仓库 `origin/dev` 的 `config/desktop-public.json` 与移动端配置均使用同一 Supabase 项目域名。

用户在手机上登录失败，现场再次点击登录复现提示“账号服务连接失败，请确认当前 Wi-Fi 的账号网络通道可用后重试”。`jzwidvczdjbkontidwpy.supabase.co` 在手机和 1.1.1.1、8.8.8.8、223.5.5.5 上均无法解析；从本机通过测试包配置的 `192.168.1.101:7890` 代理连接该域名，CONNECT 返回 200，但 TLS 握手失败。相同代理可访问其他 HTTPS 站点。因而目前无法完成登录及登录后的业务验收；不能认定账号密码错误。需由服务方确认 Supabase 项目域名或提供可用的 HTTPS 账号入口，再重新构建两种包和复测。

## 遗留事项
- 确认云账号入口恢复或替换为真实可用的同一账号服务，然后在手机上复测登录和业务请求。
- 如远端恢复，重新确认最新 main；否则以 GitHub API 与本地 `origin/main` 相同提交 `3bd6e77` 为已核对基线。
- 正式版需要签名凭证才能生成 release 包；不能把密钥纳入仓库。
