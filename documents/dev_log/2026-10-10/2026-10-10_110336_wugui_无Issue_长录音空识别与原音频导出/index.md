# 长录音空识别与原音频导出

## 基本信息

- 创建：2026-10-10 11:03:36 Asia/Shanghai；作者wugui。
- 分支：codex/meeting-streaming-reliability；状态：调查/开发中，尚未提交。
- 用户要求：导出刚录的50分37秒原音频，排查新模型502和App导出报错。当前恢复手机操作授权；UI/UX全面升级方向已确认但尚未实施。
- 约束：保留原音频、所有成功转写和账号隔离，不跳过未知错误、不把ASR错误归因于LLM。

## 调查与验证

- USB连接确认。原音频复制到电脑Downloads，49,114,564字节；手机和电脑SHA256一致：f0debfdea677f57ed40448594ea0aaf9a01dcf25418881283be141cc7503036b。ffprobe时长3036.705669秒；未转码、裁剪或删除手机原件。
- 新记录51段转写已有50段成功（9586字符），缺零基索引49（49:00–50:00）；没有完整transcript、尚未调用新LLM。当前总结配置codex/gpt-6-luna。
- AWS公网容器数据库只读查询：今天02:58和03:00 UTC的ASR错误均明确为Volcengine ASR returned an empty transcript.；App却显示泛化HTTP502，需确认公网响应格式/错误传播。
- 缺失段本地音量诊断mean -59.4 dB/max -25.9 dB，不能单凭此证明无语音，也不据此自动跳过。
- 公网10秒合成空音频验证：HTTP502，text/plain，16字节，1457ms；上游明确空识别信息在公网响应中丢失。会议内容、凭据和媒体不进入Git。
- 导出根因：react-native-share的FileProvider未覆盖私有recordings/accounts目录。新增限定files-path，导出前校验账号、路径及非空常规文件；直接分享原件。
- 导出TDD先失败后通过；全量Jest 27套111项、XML验证1项、TypeScript检查通过。公网独立Debug构建成功并覆盖安装；APK SHA256为4c14dff6dad1cb8f0ecb0f72c10a6fce3192aa5fb24467c8ae601ad91efc1e26。
- 真机系统分享显示49.11MB，点击保存提示成功；系统保存文件与手机私有原件、电脑导出SHA256一致。
- 服务端codex/asr-empty-result分支修复：仅明确的火山/阿里空识别或成功空文本返回200、空文本及unrecognized标记；保留音频历史。其他错误仍502。相关21项测试通过，代码已核对，尚未部署或提交。
- AWS当前镜像vilab-server:dev-503ab11，Compose位于/home/ubuntu/vilab-server-v0.4.0/compose.deploy.yml；后续更新需保留当前镜像用于回滚，并验证真实公网响应后再重试手机缺失段。
- 继续核对发现Compose工作目录源码过旧；当前镜像实际构建源码在/home/ubuntu/vilab-builds/pr143。src/public_api.rs的SHA256为216cd489b79a4fb5bf06e17b7ed6cb85d2bd485a90f459e4b0f7662b9972dd34，与本地HEAD 503ab11完全一致。
- 在AWS独立目录/home/ubuntu/vilab-builds/asr-empty-20261010准备最小修复，排除.env、Git、依赖及构建缓存；原部署目录、镜像、数据卷未修改。修复源码SHA256为510b4bbaec6cac35e8362ee2dc593460fe25eceeb9d67e25d3914c004045e8ad（等价生产逻辑，未复制新增本地测试）。后台构建镜像vilab-server:asr-empty-510b4bb，限制Cargo并行任务为2；尚未切换公网容器。
- 用户明确回复“允许更新并验证”，授权构建成功后更新AWS香港VILab公网容器并短暂重启。已准备检查当前镜像、备份Compose和一致性SQLite、更新单个服务、公网健康检查、失败恢复原镜像的部署脚本，以及公网10秒合成空音频验收脚本；凭据仅在服务端内存读取。
- 镜像构建成功（Cargo release 3分05秒，build.exit=0）。授权更新完成，镜像ID sha256:9b443bd1320b60478ee6fae0f8bd2f78618d24a52c8ce85e249e9e072fc80050；原镜像仍保留，Compose和一致性SQLite备份位于隔离目录rollback，权限限制。公网健康200。
- 更新后真实公网10秒合成空音频：HTTP200、unrecognized=true、unrecognizedReason=empty_transcript、1385ms。原502协议问题验收通过；随后重启手机App继续已保存进度，完整会议总结仍待验收。
- 真机完整处理验收成功：仅补ASR索引49，8600ms；转写恢复9391ms；全部51段落盘（索引49为空识别），完整转写10349字符。codex/gpt-6-luna完成两段事实整理、草稿、事实审查和本机保存，总计78954ms；没有generation/error，noteId为app-1791597084319-gp0qf4uck97。录音库显示“纪要已生成 · 原音频已保留”，版本1正文正常打开。
- 验收发现首页仅首次加载，后台恢复完成仍展示旧失败状态。补充App恢复完成后库版本通知，HomeScreen随版本刷新并重置已恢复的错误标记；不触发重复生成。TypeScript和已有首页交互测试通过，ESLint无错误（原有void风格警告）；重新构建公网Debug准备更新到手机。
- 最终公网独立Debug构建46秒成功并覆盖安装Success，APK SHA256为4104dcd8d02504a07ccc2a7f7b0d52eebb7803cf3c0f19ca352eb3b009b1458e。真机首页显示本次录音与同名新纪要“版本1”，不再显示旧“需要检查”提示，登录和录音保留。

## 验收

- [x] 原音频完整导出及校验。
- [x] 查清502的公网响应链路并实现保守修复（尚未上线）。
- [x] 导出修复具有失败/成功证据，并在真机系统分享/保存入口验证。
- [x] 复用50段成功转写，保留未识别区间及原声，完成该会议处理验证。

## 关联

## 2026-10-10 合入审查｜wugui

- 用户授权两仓库提交、推送、中文PR和正常安全合入；App目标main，服务端目标dev。
- 审查发现XHR完成但status=0被包装为普通HTTP错误，无法按连接中断恢复；新增用例先失败（promise错误地resolved），改为TransportError后同一测试通过，并释放回调/计时器。
- 对首页后台完成刷新追加回归测试（事后补测，不声称先写测试）：旧失败状态消失、新纪要可打开。
- App全量27套113项、脚本5项、TypeScript通过；全库ESLint无错误、55项既有风格/测试警告。App.tsx及README原有混合换行在提交中规范为LF，功能差异已按忽略行尾空白核对。
- 服务端按CI verify命令执行Node脚本/admin/语音mock/SDK检查，以及七组Rust测试和两个bin的locked check，全部通过。rustfmt检查指出基础版本既有目录列表格式，新增修复范围未引入对应格式问题；不扩大功能修改。
- 准备提交本档案及已验证代码，保留既有音频、账号隔离、事实检查及v8成功检查点。未提交APK、凭据、会话或私人音频。

- [此前流式总结修复](../2026-10-10_090741_wugui_无Issue_会议总结流式传输与超时修复/index.md)。
