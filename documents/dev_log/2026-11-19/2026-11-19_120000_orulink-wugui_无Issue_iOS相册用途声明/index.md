# iOS 上传后处理缺少相册用途说明

- 创建日期：2026-11-19，Asia/Shanghai；作者：orulink-wugui
- 分支：codex/ios-photo-purpose；类型：发布配置修复；状态：本地验证通过，归档与 Apple 后处理待验证
- 用户要求：代码问题修复后继续外部 TestFlight，不改变 Android 发版。

## 根因与边界

App Store Connect → TestFlight → iOS → Build Uploads 显示 0.1.5 (7) Failed，错误 90683 明确缺少 NSPhotoLibraryUsageDescription。react-native-share 的 InstagramShare.m 静态引用 PHPhotoLibrary，即使 VINote 只调用系统 Share.open 也会被扫描。补充主动相册分享操作的用途说明，不新增自动授权或相册依赖；录音与音频文件导出维持原行为。

## 变更

Info.plist 增加非空用途说明；iOS 构建号从 7 升至 8，营销版本仍为 0.1.5；发布版本检查加入防回归断言；部署文档说明上传传输与 Apple 后处理是不同阶段。Android 版本保持不变。

## TDD 与验证

- Red：先增加 release-version.test.cjs 测试，node --test 运行得到 3 通过、1 失败，断言报告 Apple ITMS-90683 缺少用途说明。
- Green：补充用途说明后 npm run test:scripts 共 20 测试通过。
- 未重构。实际归档、包内声明与 dSYM 验证、Apple 重新上传处理尚在进行，不以离线测试冒充发布成功。
- 2026-11-19，orulink-wugui：检查 diff，仅提交上述配置、测试、文档与本档案；未包含私人开发日志或凭证。
