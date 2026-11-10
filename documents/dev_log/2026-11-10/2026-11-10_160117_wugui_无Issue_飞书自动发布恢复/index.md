# 飞书自动发布与恢复

## 基本信息

- 创建时间：2026-11-10 16:01:17，Asia/Shanghai
- 作者：wugui
- 分支：codex/meeting-asr-20261102
- 状态：进行中；本地修改，尚未提交或发布。

## 目标与边界

会议纪要生成后，按设备明确保存的设置发布并通知；保证重复触发、账号切换、网络故障及未知结果恢复时不重复发送。用户此前明确要求设置不跨 VINote 账号同步。不得自动发送到猜测的参会人。

## 当前发现

App 的旧 outbox 只有快照，没有 operation ID；恢复时不能判断原请求是否已发送。桌面自动交付由桌面本机管理，公网自动提交入口当前有测试明确要求不存在；共享集成服务不接受通过普通手动接口冒充自动授权的请求。移动端需要专门的设备级授权、提交与回执协议，以及服务端部署配合，不能直接复用桌面本机接口。

## 本次变更与验证

旧格式 outbox 同一账号及笔记的重复写入保留最早的未知记录，并串行化写入；账号会话变更时不写入。该修复不会让旧记录自动发送。

- Red：新增并发写入测试，修改前第二个快照覆盖了第一个，测试失败。
- Green：`node node_modules/jest/bin/jest.js __tests__/feishuOutbox.test.ts __tests__/sessionGate.test.ts --runInBand --watch=false --silent`：2 suites、79 tests 通过。
- 服务端协议核验：`pytest tests/test_feishu_auto_policy.py::test_public_automatic_endpoint_is_absent_desktop_owns_dispatch tests/test_feishu_status_negotiation.py::test_automatic_post_is_not_exposed_by_cloud_http -q`：2 tests 通过。
- 补充账号切换期间旧记录读取的回归测试：`jest __tests__/feishuOutbox.test.ts --runInBand --watch=false --silent` 3 项通过；`npx tsc --noEmit` 通过。

## 2026-11-10 后续实现

- 本机保存绑定飞书连接和通知设置的一次授权，关闭后重开使用新的授权 ID；生成纪要前持久保存原 operation ID 和交接快照。
- 设备队列固定发送内容、来源、目标和操作标识；未知结果只查询原操作。服务端新路由以连接绑定校验、持久回执和指定任务恢复保护交付；旧服务不支持时保持等待。
- 删除前核验原交付，未开始的可安全取消，未知/进行中的不冒充已停止；本机队列及关联历史回执正文清理。
- 任务页显示本机飞书任务，前台定期核验。独立审查发现并修复交接恢复、旧授权复用、连接切换、删除和服务重启边界。

## 验证与尚存工作

- Android Jest 全量在后续修复前 162 组 1397 项通过；后续按变更运行针对性回归。TypeScript 和 17 项构建脚本检查通过。
- 最后针对性回归：10 组、109 项通过，TypeScript 通过。Android Debug 构建进行中；具体设备和服务端结果单独记录。
- Android arm64 Debug 构建通过并安装到独立调试包；当前正式版是 0.1.11 / versionCode 16，本机发布签名与该正式版证书一致。为新正式包递增至 0.1.12 / versionCode 17，版本脚本检查通过。
- 服务端隔离数据库覆盖绑定、去重、文档及通知的模拟提供方调用、连接变更、精确恢复和取消；不代表实际飞书已送达。
- 公网部署、手机端与真实飞书验收、PR 审查合并尚待完成；未将源码或离线结果当作上线结果。

## 关联历史

延续 [App 核心链路与更新](../../2026-11-06/2026-11-06_190000_wugui_无Issue_App核心链路与更新/index.md) 中的飞书发布与设备隔离工作。
