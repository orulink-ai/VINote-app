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

Android 模拟器默认访问 `http://10.0.2.2:8900`，iOS 模拟器默认访问 `http://127.0.0.1:8900`。真实设备请把 `src/config/env.ts` 中的地址改为电脑局域网 IP，并确保后端监听 `0.0.0.0`。

首次安装原生依赖后，iOS 需要执行：

```bash
cd ios
pod install
```

父项目仓库通过 Git submodule 关联本仓库的 `VINote-app/` 目录。
