# VINote App

VINote 的 React Native 原生移动端，使用 Community CLI，不使用 Expo 管理工作流，同时支持 Android 与 iOS。

首期闭环包含：

- 账号登录与注册
- 原生麦克风录音
- 上传录音并在云端生成会议纪要
- 查看会议纪要列表和详情

账号和笔记复用 VINote FastAPI 及现有数据库。登录响应同时提供桌面端 Cookie 和移动端 Bearer Token；App 将 Token 保存到系统安全存储后访问同一套业务接口。移动端拥有独立的视觉和交互。

## 本地运行

```bash
npm install
npm start
npm run android
```

固定 VILab 地址为 `http://192.168.1.143:9876`，在 `src/config/env.ts` 中配置。独立 APK 内置 JS，无需 Metro、电脑后端或 USB reverse；手机必须能够访问该局域网，账号认证还需要访问 Supabase。源码热更新开发仍需要 Metro。

Android 构建使用 SDK / Build Tools 36、NDK 27.1.12297006。本机 SDK 位于 `D:/tool/sdk/android`，Java 21 可使用 Android Studio 的 `jbr`。若 Windows 构建出现 `Unable to establish loopback connection`，将 `JAVA_TOOL_OPTIONS` 设置为 `-Djdk.net.unixdomain.tmpdir=D:/tmp -Djava.io.tmpdir=D:/tmp`（目录须已存在），再启动构建。

首次安装原生依赖后，iOS 需要执行：

```bash
cd ios
pod install
```

父项目仓库通过 Git submodule 关联本仓库的 `VINote-app/` 目录。
# 手机注册与统一账号

录音页默认仅保存原音频，可切换为结束后生成纪要。两种模式均先保存到应用 Documents/recordings，包含独立音频文件及元数据（名称、时间、时长、任务 ID、失败原因、关联纪要）。录音库支持播放、系统导出、确认删除、后续生成和恢复原任务；重启后仍可查看。Android 已加入麦克风前台服务，iOS 已配置后台音频；平台验证范围见下方 1.1.0 说明。生成纪要仍需保持前台。导出调用系统分享/文件保存入口，目标取决于手机已安装的应用；iOS 通过文件保存面板。卸载 App 会删除应用私有录音，应先导出。

登录页提供“忘记密码？”：通过注册邮箱接收验证码，填写验证码、新密码及确认密码后重置，成功后回到登录页。错误或过期验证码不会跳过验证。手机和桌面端共用新密码。

请求携带 mobile/platform 和 X-VILab-Client-Id 后台来源标记，不向用户展示。直连版本不经过电脑 auth_login_events，独立登录审计表尚未对接；VILab 请求记录可标识手机来源。手机和桌面端支持同时登录；普通退出仅清除当前终端凭证，不删除其他终端依赖的共享云端会话。

App 请求显式禁用 Cookie，仅使用 Keychain Bearer Token。网络不可用时仍清除本机凭证并退出；Keychain 清除失败不会被吞掉。独立 APK 不依赖开发服务器。

手机可直接注册，与桌面端共用 VINote 账号。云端模式下先发送邮箱注册验证码，再验证并登录；验证码发送后锁定邮箱和密码，返回登录会清空注册表单。不会在云端连接失败时改用另一套本地账号。

所有 App API 请求携带 `X-VINote-Client: mobile` 与 `X-VINote-Platform: android/ios`。这些标记不作为权限依据；当前直连版本的登录审计接入范围见上方账号说明。

账号直接连接同一 Supabase 项目，访问令牌和刷新令牌保存在 Keychain，401 时刷新并重试一次。旧版电脑 JWT 不可复用，升级后重新登录。旧版录音文件仍保留在旧账号目录，尚未迁移；不自动归属给新登录账号。

### App 云端模型与界面（2026-09-23）

App 使用 Tamagui 2.7.7 Provider、Button、Input、Card 和布局组件；部分页面仍保留 React Native 基础布局，不代表全量迁移完成。首页、纪要列表和安全区已调整。

录制页通过 `/v1/models` 和 `/v1/default-models` 加载真实部署模型，选择按账号保存在手机。完整录音提交 `/v1/asr/transcriptions`，完整转写提交 `/openai/v1/chat/completions`；明确传递所选模型，运行中快照不变。转写完成立即落盘，总结失败重试复用转写；应用被终止时在录音库手动重试。Android 长录音按 120 秒 PCM WAV 分块上传，每段成功立即保存到本机，失败重试复用已完成段，更换 ASR 模型重新转写。超过 10000 字的转写分层整理，阶段结果落盘。仍无远端任务续传或后台处理保证。

云端返回账号认证服务不可用时，应检查 VILab 到 Supabase 的连接及可信身份配置；切换模型不能修复认证服务故障，也不能回退部署密钥绕过个人认证。

## 纪要阅读与来源

App 纪要支持搜索、下拉刷新、原生 Markdown 标题/列表/表格/链接渲染、详情确认删除。删除纪要不删除本机原录音。生成来源来自上传任务持久化的 generation_client，跨端查看与编辑保留；历史缺失显示“来源未知”。该字段与仅供后台使用的登录来源审计分开。

录音与模型面板使用 Tamagui Card、Button、Input、Text、XStack/YStack；系统录音权限、确认框、长列表和 Markdown 原生渲染保留 React Native 能力。风格采用中性底色、细边框、小圆角和单一绿色强调。
# 本次更新说明（2026-09-23）

会议名称支持录制前及录制中修改；录音库和纪要详情提供“修改名称”入口，支持保存、取消和失败重试，名称不能为空且最多 120 字。生成纪要保留录音名称。录音名称与已生成纪要名称分别管理；修改标题不会改动原始音频或纪要正文。纪要在本机按 Supabase 账号隔离保存，支持查看、改名和删除；暂不与桌面同步。卸载前需自行保留重要内容。

本机录音按 Keychain 中当前账号 ID 存放于 recordings/accounts。离线仅访问已确认账号；旧版没有所属账号信息的录音保留原文件，不自动分配给登录用户。纪要详情返回进入时的列表，删除后清理本机录音关联，其他端删除后再次查看也会检查。

图标采用原生几何设计，源文件位于 assets/branding。安装 Pillow 后运行 python scripts/generate-icons.py 重建 Android 传统、自适应、单色图标及 iOS 资源。图片生成服务额度受限，未使用生成式图片。iOS 仍需 macOS/Xcode 验证。

独立调试 APK 内置 JS，关闭开发支持，直连固定局域网服务，拔掉数据线可继续使用。录音已适配后台采集，生成纪要需保持 App 在前台。当前产物使用调试签名，不是应用商店发布包。

### Android 账号网络修复（2026-09-23）

当前 Wi-Fi 直连 Supabase TLS 握手被重置。Android 的 AccountProxySelector 仅为固定 Supabase HTTPS 域名使用部署服务现有出口 `192.168.1.101:7890`；其他请求直连，会议服务仍为 `192.168.1.143:9876`。使用 HTTP CONNECT 隧道并保留默认 TLS/主机名验证，不修改系统代理、不依赖开发电脑。该局域网出口必须在线。iOS 尚未配置同等通道，也未验证。

登录凭证和请求正文不记录到诊断日志。已在手机上使用虚构账号验证登录接口返回 invalid_credentials；真实账号登录需账号本人验证。产物：`artifacts/VINote-app-20260923-login-fix-arm64.apk`。
Android 会议转写通过 MeetingAudioModule 使用 MediaExtractor/MediaCodec 流式解码 M4A，转换为 16kHz 单声道 PCM16 WAV 上传；保留原始音频，finally 仅清理转换缓存。旧录音支持重新生成。iOS 转换已加入源码，尚未编译和真机验证。

### 长音频适配（2026-09-23）

Android 使用磁盘 WAV 缓存和有界内存分段，每次上传最多 120 秒（约 3.84 MB）。原 M4A 保留，转换缓存和上传分片在正常结束或失败时清理。强制终止后重试会重新转换原音频，但复用已成功保存的同模型转写分段。HTTP 502/503/504、连接中断和请求超时最多自动重试两次，并展示重试状态；其他失败由用户重试。认证和格式错误不会循环重试。进度按已完成音频时长显示；生成期间保持 App 前台，不保证锁屏后台执行。

总结超过 10000 字时分层压缩，阶段结果按模型、标题和完整转写匹配复用；检测模型输出截断。说话人识别按用户要求暂停，当前版本不包含本地模型、依赖或说话人标注。云端未修改。iOS 原生音频转换源码已实现，仍需 Mac/iPhone 验证，未作真机可用声明。
验证：Android 编译与 5 项针对性测试通过。2026-09-23 在 USB 真机上使用重复短语音构造的 250.03 秒样本，实际完成 3 段云端转写、逐段落盘和纪要保存（app-long-audio-check）。这验证跨段闭环，不代表一小时以上真实会议质量或后台稳定性已验收。安装包为 artifacts/VINote-app-20260923-long-audio-arm64.apk。


## 1.1.0 本地录音与双端适配

- 开始录音前将草稿保存到当前账号私有目录；结束时确认非空文件，再保存完成状态。重新进入录音库会找回遗留音频和未完成草稿，缺失/中断项不会静默消失。中断的 M4A 可能未写完容器，保留文件不代表必然可以修复。
- Android 麦克风前台服务支持切换其他 App 和锁屏，通知点击返回录音页面。iOS 使用 AVAudioSession 和 UIBackgroundModes audio；系统强制结束、来电、其他应用争用麦克风仍可能中断，需真机验证。云端转写/纪要处理目前仍要求前台，不是系统后台任务。
- 默认标题为本地开始时间＋会议录音；生成纪要后从模型输出的具体主题标题命名。仅保存录音不会请求模型。手动名称不会被覆盖。导入记录标记导入时间，不推断真实会议时间。
- 录音库「导入音频」调用双端系统文件选择器，先复制到私有目录，用户再选择播放、导出或生成纪要。允许 M4A/MP3/WAV/AAC/FLAC/OGG 扩展名，实际支持取决于系统解码器，损坏或不支持文件报错并保留已有录音。取消选择不创建记录。
- iOS 新增 MeetingAudio 原生模块，流式转换为 16kHz 单声道 PCM WAV，再按 120 秒分段上传。Windows 无法执行 Xcode 编译和 iPhone 验证；Mac 上需 pod install、签名、Release 构建后验证。
- 音频和纪要仍按账号保存在本机，不是云端跨设备同步；卸载会移除本机数据，重要录音请导出。

### 发布地址

config/deployment.json 是安装包内置部署配置，不向用户暴露配置表单。apiBaseUrl 为 VILab Origin；authBaseUrl 为保留 /auth/v1 路径、TLS 和认证语义的账号入口。现有 channel=lan 继续使用已部署内网服务及 Android 账号 CONNECT 代理。iOS 使用直接 HTTPS 登录，没有自动复用 Android 的局域网代理，其网络连通性待验证。

公网发布须由部署方提供稳定 HTTPS 服务入口；改为 channel=public，填写两个可公开访问的入口并清空 accountProxyHost。Babel 打包时执行 scripts/validate-deployment.cjs，阻止将私网地址/代理标记为公网包。该检查不验证服务真实连通性。当前未创建隧道、未修改云端服务器，也未完成外网可用性验收。Android 正式发布仍需生产签名，当前 standalone 调试包内置 JS，不依赖 USB/Metro。

### 真机验收

1. 安装 standalone 包，拔掉 USB，仅录音并结束，关闭重开 App 后确认可播放、导出。
2. 分别在 Android/iPhone 录音中切换其他应用、锁屏数分钟，再回到 App 结束并检查时长与完整音频。
3. 来电中断、进程被系统结束、磁盘空间不足时检查错误反馈与记录恢复，不保证被杀进程的媒体完整性。
4. 导入音频，确认取消不留空记录、退出重开原音频可播放、长音频转写失败后可重试。
5. 公网入口具备后在蜂窝网络完成首次登录、模型列表、长音频上传与纪要闭环。
