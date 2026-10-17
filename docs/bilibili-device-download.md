# Android设备保存B站音频

本路径是用户明确选择的文件获取动作，与公网video_url能力和来源预检独立；不是服务412后的自动回退。进入文件库之后仍须明确点击生成，复用现有公网上传，不在解析或下载中调用ASR/LLM。

## 使用与安装

需要含MeetingFiles.bilibiliDownloadProtocol=1的新Android包；Metro不能提供新native方法。新版Android输入公开B站/b23.tv链接，内容服务就绪后，主按钮为“读取B站内容”，确认流量后保存音轨（不超过当前服务上传预算与128MiB原生资源预算较小值）。该场景不再重复展示次要下载按钮，也不通过公网URL生成来读取B站。保持前台；可随时取消。文件保存后才显示“生成总结笔记”，需再次明确点击才上传处理，不自动调用模型。iOS的B站链接提示导入文件并阻止URL提交；旧Android没有native设备下载，须升级才能使用此入口。

native路径需要内容服务ready，以便后续文件处理；不受服务video_url/video_url_platforms远端抓取范围禁用。非native的原公网URL路径仍按视频能力和只读来源预检限制；unknown/reserved及既有任务始终走原查询，不能触发设备下载或自动fallback。

完成文件保存在files/accounts/<owner>/<uuid>.m4a及原子meta.json，purpose=note/source=bilibili，不移录音库。文件库详情可查看原URL、BV和分P；生成保存后的笔记“来源链接与分P”同样显示这些来源。标题、aid/cid、时长、规范URL和下载operation一并保存；不持久化CDN签名地址。原件、来源与已保存正文独立保留。

## 网络与资源边界

- 专用OkHttp客户端直接连接，不共享RN/VINote Cookie、认证拦截器、代理或账号请求；方法没有token/header参数。只发送固定普通UA、公开B站Referer及identity编码，不取浏览器Cookie，不绕验证码、付费或登录限制。保留正常HTTP2/HTTP1.1协商，不按错误自动换网络、代理或协议重试。
- 只接受HTTPS443、无凭证/fragment、规范BV/av及合法分P，b23短链接逐hop最多4次。元数据仅api.bilibili.com的view/playurl固定端点；媒体仅bilivideo.com/bilivideo.cn/acgvideo.com子域。每hop均重新校验角色、HTTPS、host，DNS整组必须公网地址，使用被校验的DNS结果进行该TLS连接。自动重定向和连接重试关闭。
- JSON单响应<=2MiB且深度<=32；只选非preview/nonVIP的AAC MP4音轨，最低正bandwidth节约流量，不下载播放列表/视频。音频原生8192B缓冲写入，正文写入前检查硬字节上限，已声明超限在读取前拒绝，短读拒绝，未知长度最多一字节额外应用层探测即失败；TCP/OkHttp内部缓冲不是应用层可承诺的精确计费流量。最终还检查ftyp与MediaExtractor真实音轨且不含视频。
- 连接10秒、单次读取20秒、每请求60秒、全操作最多5分钟；没有自动重放或断点续接。进度最多约每250ms发给JS。取消/转后台/退出账号/身份epoch变化使job失效，调用Call.cancel并等待native Promise结束；临时part/m4a清理，未登记文件不成为资料。
- 完成后二次核对owner/epoch、native来源字段及实际文件大小，二进制移动与metadata提交分步guard。取消前已完成原子登记的原件保留在原账号，不移到新账号。缓存只使用固定jobId文件，不允许任意删除/输出路径。

## 上传与旧记录

下载操作UUID同时冻结为该下载文件首次上传的operation，beginLocalFileAssociation仍核对真实元数据与文件大小。若该下载文件已经关联prepared/unknown/reserved/accepted/saved操作，只调用原source-requests GET恢复，不能生成新operation代替原任务。原Intake任务return/recover顺序不变，旧failed/unknown没有自动下载/上传/模型重跑。文件管理明确再生成其他版本的产品合同不是本轮扩展范围。

新操作在持久化operation前读取当前账号模型选择、复制快照并强制刷新目录校验，不自动改用其他模型。视频/音频需要所选ASR及LLM；网页、文档和逐字稿只需要LLM。URL请求以JSON顶层model_name/asr_model发送；公网上传读取独立multipart字符串字段，不读取单个options JSON。modelSelection随原操作保存；已存在operation或下载文件关联时先走原回执恢复，不加载当前选择来覆盖旧记录。

reserved表示提交已登记，尚未确认任务启动。页面显示“提交待核验”，不显示任务进度圈；核验只GET原source-request，不轮询不存在的task，也不再次POST。用户可明确确认“整理另一份内容”：先保存原操作档案并保留原文件关联，再清空当前输入槽。新来源仍需另行点击生成；再次选择原已关联文件仍核验旧操作，不换operation冒充新任务。操作档案保留不代表本轮新增了全量历史列表。

## 离线检查与实际边界

命令：python scripts/check-bilibili-native-offline.py。使用已有Kotlin2.2.10、RN0.87.1、OkHttp4.9.2和Android36缓存，编译真实policy/downloader/MeetingFiles桥接；不下载依赖、不运行Gradle、不连接设备。执行真实共用URL/DNS/字节/取消/JSON界限policy，以及实际private hop loop配合合成Interceptor响应的无凭证、重定向、412不重放、取消前零请求检查。合成Response的HTTP2标记不代表实际HTTP2联网通过。

Jest与tsc分别覆盖JS注册、取消/账号切换/后台/迟到结果、笔记保存编辑重开来源、UI确认及未知上传GET-only。模拟HTTP响应不是实际TLS/DNS/CDN证据；真机取消、后台/账号切换清理及更多来源仍需单独验收。iOS没有此native实现。本代理不执行真实下载/ASR/LLM、不部署、不commit/push。

## 2026-10-17 实际证据与待验收项

以下设备及服务器事实由主线程报告，本代理没有操作设备或发起真实请求。

- 初版Android包保存40秒公开样本返回HTTP403，没有创建generation或调用ASR。电脑Python安全resolve对同视频仅metadata成功，不能判定视频失效。
- 对照发现native为Mobile UA，Python为桌面Chrome UA；Referer、identity与view/playurl参数一致。对齐UA并加入阶段诊断后的APK366a实际保存音轨成功，原文件进入笔记资料且BV/分P可见。这只证明该次下载及来源保存成功；不能据此断言全部403由UA导致，或云机412已经解决。
- VINoteBilibili警告日志只含short/view/playurl/audio固定阶段、HTTP状态码与协议。用户错误区分来源/音轨，不输出URL/CDN签名/IP/token/响应内容。仍禁止代理、Cookie、验证码绕过及自动重试。
- 随后用户明确生成一次，返回所选云端模型不可用。主线程只读确认原记录仅reserved、无task文件夹、模型准备失败且无ASR；旧操作和原件保留。源码定位到noteIntake未loadSelection/loadModels、未发送模型字段，已补冻结/校验/传递；不能把旧模型不可用全部归因于漏传字段。
- 主线程在App确认Aliyun paraformer-realtime-v2保持不变，将不可用旧LLM改选为deepseek-v4.1-flash。这是用户明确的新选择，不是自动fallback；旧reserved不补改、不重放。
- 模型选择与reserved修复的tsc、定向Jest两套60项已通过。主线程报告新包APK51111baf构建成功后，本代理对当前冻结源码执行heap512单worker全量Jest：126套1175项全部通过，28.258秒、退出码0，离线网络守卫启用。日志为忽略制品artifacts/delivery-prep/bilibili-selection-jest-full.log。此前126套1167项属于新增模型imports前版本，保留为历史证据，不混用。
- 最终入口修复后，tsc、定向两套62项及全量126套1177项通过；全量heap512单worker、24.646秒，日志artifacts/delivery-prep/bilibili-primary-jest-full.log。该离线结果与以下设备证据分别记录。
- 主线程报告最终APK db67fca已安装：App主按钮“读取B站内容”实际读取40秒公开样本成功；随后用户明确发起独立新生成，新operation/task收到accepted。实际冻结ASR为asr:6:aliyun:22:paraformer-realtime-v2，LLM为deepseek-v4.1-flash，没有自动换模型。真实任务已success，transcript/result/note.md产物存在；App已保存并打开正文，显示保存时间2026/10/17 12:55:38。具体operation/task及账号ID不公开记录。
- 新成功操作与此前模型准备失败操作独立；旧操作仍reserved、零ASR，没有补改、重新POST或用新操作替换其记录。
- 主线程随后实际返回笔记列表，再打开该新笔记成功；展开“来源与身份”确认BV13At46PEGQ、第1P及原HTTPS链接正确保留。raw status为success，result报告duration=39.520375秒、Markdown742字符、segments=1。该单样本已实际完成设备下载→公网上传→Aliyun ASR→DeepSeek→App保存→返回列表重开→来源核验；原ASR没有重跑。默认界面仍使用独立笔记，不改变会议/笔记分类或同步合同。最终包仍为db67fca，主线程确认来源源码hash稳定。
- 主线程进一步实际核验文件库：切换“笔记资料”显示两份317.8KB M4A，旧reserved与新success操作的原件均保留；打开新文件详情可见BV13At46PEGQ、第1P、原链接，任务/已保存关联处可查看完整新笔记标题。导出/删除入口存在，仅验证入口可见，未宣称实际导出或删除成功。会议资料分组的5份原录音保持独立。关闭Sheet返回后无重复提交。
- 本次运行使用独立内置JS公网包，无USB reverse；这不证明已经物理拔下USB。native真实取消未测。该样本通过不等于所有来源/网络通过；桌面成功不替代App证据，云机412和全部403根因仍未据此证明解决。

## 2026-10-17 最新安装包复验

- 手机重新连接后，直接读取已安装 base.apk 的 SHA256，与最终验收包 db67fca04dd8fd71e1ef63c79a7f36eb3de51f8d1c205c3675714f2f820b644b 完全一致；没有重复安装、清除账号或文件。
- 实际从笔记列表打开已保存的 B站样本，正文、保存时间及编辑、删除、导出、分享入口可见；本次复验不重新读取音轨、不提交生成、不重跑 ASR。完整生成证据沿用上述同一安装包的真实成功任务。
- 打开该 B站笔记的飞书发布面板，正文预览、账号、个人云文档位置与本人通知选项正常；预览关闭返回正文正常，没有发布真实 B站内容。
- 用户在本次操作前明确同意：以现有虚构“VINote Feishu acceptance - App”笔记，创建一份个人云文档并仅通知阳晓冰本人一次。实际使用手机准备新发布、点击一次“创建并通知”，先显示等待交付，再显示文档已保存、本人通知已发送。未发送群消息。
- 点击“打开飞书文档”，手机浏览器实际打开新文档，标题、正文、列表与表格正常。通过最近应用返回 VINote，关闭并重开发布面板，仍显示完成回执和“打开飞书文档”，未再次创建或通知。
- 同一账号的飞书桌面客户端实际显示本次新通知卡片：标题、个人云文档位置、“打开文档”按钮与“由 VINote 发布”署名；没有将 Markdown 正文和表格源码塞入消息。此前验收卡片保留，本轮只新增一次获准通知。
- 本轮未新增产品源码修复，补充的是实际验收证据；不把已保存结果复验说成重新执行 ASR，不扩大到 iOS、群实收、真实取消或所有视频来源。
