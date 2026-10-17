# App 文件库按资料用途分区

- 创建：2026-10-12 17:57:43 Asia/Shanghai；建档作者 wugui；无 Issue。
- 用户要求：移动端会议资料与笔记资料先分区、格式次级筛选；导入明确用途，保持原件返回、重试、删除；仅 JS，不安装或构建手机包。
- 边界：不改 ASR/说话人处理、原生模块、桌面、后端；不读取私人文件内容，不删除任何真实原件。
- 已实现：新文件记录用途与导入来源；已有录音属于会议。旧 LocalFile 缺用途不能根据扩展名推断，用独立用途记录保留原元数据/关联，显式确认后归类。
- Red：FileLibraryScreen 新用途隔离、上下文导入、未知用途三项回归于旧实现失败；同组旧关联用例因误插切换语句也失败，已纠正测试位置，不作为业务证据。
- 用户接续修正已实现：二级格式仅全部/音频/视频/文档；录屏与导入视频使用真实来源标签。无真实录屏不制造条目。移除所有产品中的技术编号/处理编号展开；处理状态与真实关联正文保留。会议空状态明确“还没有会议纪要”，增加“查看录音与会议资料”原件入口，不复制原件管理界面。

## 改动文件

- `src/screens/FileLibraryScreen.tsx`：用途分区、格式筛选、来源标签、上下文导入、旧用途选择；关联/重试/导出/删除保持。
- `src/lib/localFiles.ts`：新导入元数据 purpose/source；旧用途独立 sidecar 持久化，账号与真实文件元数据核验；删除原件时清理用途记录。
- `src/screens/NoteIntakeScreen.tsx`：只改导入参数，明确笔记用途与原 owner；不改任务执行/恢复。
- `src/screens/NotesScreen.tsx`、`App.tsx`：会议原件入口与空状态，文件库分区/筛选返回保持。
- 四个更新测试：`FileLibraryScreen.associations.test.tsx`、`localFiles.intake.test.ts`、`App.navigation.test.tsx`、`NotesScreen.test.tsx`。
- `localFileLinks.test.ts`：原先两个测试仍模拟被取消的共享同步投影，失败；改为当前本机正文稳定 ID/本机回收站夹具，保留真实关联及 owner 隔离断言，不修改业务来迎合旧同步行为。

## 最终验证

串行 Node 512 MiB，Jest `--runInBand`，7 suites / 69 tests 全部通过：

```powershell
node --max-old-space-size=512 node_modules/jest/bin/jest.js --runInBand __tests__/FileLibraryScreen.associations.test.tsx __tests__/localFiles.intake.test.ts __tests__/App.navigation.test.tsx __tests__/NotesScreen.test.tsx __tests__/NoteIntakeScreen.test.tsx __tests__/noteSourceFiles.test.ts __tests__/localFileLinks.test.ts --silent
node --max-old-space-size=512 node_modules/typescript/bin/tsc --noEmit
```

App 类型检查无错误；改动 tracked 文件 diff whitespace 检查通过。导航测试用模拟页面验证回调/参数与返回，真实录音播放器测试不在本轮；未构建安装、未操作手机或原文件、未触及 ASR/说话人/桌面/后端。

## 剩余实际边界

- 父代理进行最终实际手机走查；本轮自动化不冒充真机结果。
- 旧文件必须明确选择用途，不猜旧资料归属；选择只改变原件分类，不重分类任何已关联笔记或纪要。
- 导入会议音频沿已有原录音详情生成路径；其他会议文件仍可导出/删除，未新实现视频纪要生成。App 本轮没有新增录屏捕获能力。
- JS 保存可由现有 Metro HMR 接收；不重开服务或安装 APK。
