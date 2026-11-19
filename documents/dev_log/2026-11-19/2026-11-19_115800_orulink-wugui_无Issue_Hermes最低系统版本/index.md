# Hermes 源码归档缺少最低系统版本

- 作者：orulink-wugui；2026-11-19，Asia/Shanghai
- 分支：codex/ios-hermes-metadata；状态：本地验证完成，上传处理待确认

## 目标、根因与边界

继续用户要求的 iOS 外部 TestFlight。构建 8 相册用途已修复，上传验证发现 Hermes Info.plist 缺失 MinimumOSVersion；xcrun vtool 确认实际二进制 LC_BUILD_VERSION 为 IOS、minos 15.1。CMake 源码框架没有投影该字段。保留源码构建及真实 dSYM，不改二进制、不更改最低支持版本、不修改已签名包。

## 实现与 TDD

新增归档检查脚本，显式选项仅补齐未签名 Hermes 缺失字段，值来自真实二进制；所有框架只读检查，冲突或歧义拒绝。文档和 CI 增加固定入口。

Red：空实现时 5 个 unittest 用例产生 7 个断言失败，涵盖提取、非 iOS/歧义、缺失字段、无副作用补齐和冲突保护。真实未修复构建 8 归档只读检查报告 Missing MinimumOSVersion。

Green：5 个测试通过；真实构建 8 归档补齐 15.1 后只读检查通过，2 个可执行文件的 dSYM UUID 仍匹配。没有重构。修复后的再次上传、Apple 处理和 Beta 审核独立验收。

2026-11-19｜orulink-wugui：提交脚本、测试、CI 和发布文档；无凭证与私人日志。前一相册用途修复的结论仍有效，本次为其后续打包检查补充。
