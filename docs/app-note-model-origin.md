# App 笔记模型来源

0.1.4 的新笔记操作在设备执行编排，两包使用同一条链路，仅固定 VILab Origin 不同。账号、飞书和纯提取服务可共享；模型 ID 相同不能证明模型服务相同。

- 媒体与设备已保存的 B站原音轨：核验账号目录及文件 SHA-256，复用 `meetingCloud.transcribe` / `asrStream`，连接该包 `API_BASE_URL`，不上传到公共 generation worker。
- 普通网页、PDF、DOCX、TXT、MD、SRT、VTT、JSON：只向共享服务提取正文，不在该服务调用模型。文本不运行 ASR 或说话人。旧版 DOC、扫描/加密文档继续给出明确失败。
- 生成笔记使用笔记专用提示词及 `chatCompletion`，固定连接同一 `API_BASE_URL`；不调用会议 summarize，不额外增加标题模型调用。保存沿用 `saveSourceNote` 的正文主题命名。

## 纯提取协议

服务 capabilities 必须声明 `text_extraction_protocol: 1`。

| 路由 | 请求 |
| --- | --- |
| POST `/api/content-service/extract-url` | JSON `{url}` |
| POST `/api/content-service/extract-file` | multipart 仅 `file` |

响应 `{extraction_protocol:1,title,text,source_sha256,source_type}`。客户端要求有效正文、SHA-256格式及最多2,000,000字符，文件提取上限取服务预算和20MiB较小值。接口由 root 提供；未部署或协议不兼容时不回退旧 generate API。媒体直连及设备B站下载不依赖共享提取服务就绪。

## 冻结、恢复及来源

新 operation 在账号命名空间保存协议、固定模型 Origin、具体 ASR/LLM ID、来源 URL/文件哈希、提取哈希、阶段及检查点。接收回执之前已有持久操作和进程内 claim，首读不查云 task。ASR 每个实际区间沿用旧 durable inFlight；LLM 在发送前写 marker，未知结果/进程退出/结果写盘失败不得重放或更换服务。同来源未知请求也不能通过新 UUID 绕过。明确拒绝和推理前失败只允许用户继续同一冻结操作，不自动重试。

完整转写及正文先写设备操作，保存失败只重新保存，不再次推理。前后台只读状态，JS进程被杀后不会自动恢复发送。账号切换停止后续阶段，不将晚到结果写入另一个账号；来源变化也不能复用旧检查点。进度来自真实转写确认区间，不预先完成尚未执行的阶段。

文件关联保留 `execution: client` 与 `modelOrigin`，本机 UUID 仅为设备操作，不发送云 task GET。已保存 source note 不冒充录音 ID；文件库保留原件及关联笔记。旧云回执不升级、不迁移、不新做ASR，仅原 receipt/task GET 与成功结果保存；旧云 retry 不由本入口发起。

## 验收边界

本轮仅源码、离线模型/网络 mock、真实 SSE 收集器及相邻传输测试。没有真实 ASR/LLM、APK/IPA 构建或安装。root 纯提取部署与两种安装包真实验收需后续明确记录。

未知/终态失败可显式“保留记录，整理其他资料”：按owner串行校验当前operation/task/modelOrigin/models/source和冻结记录一致，归档原回执后仅清输入槽，保留完整设备操作、原件关联及inFlight。不同资料可以新建操作；同字节未知仍阻断。旧选择或并发晚到保存不能清除新的输入；查询、返回、前后台切换不执行此退出动作。
