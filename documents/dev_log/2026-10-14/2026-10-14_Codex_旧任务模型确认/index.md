# App 旧任务模型确认

- 作者：Codex；日期：2026-10-14 Asia/Shanghai
- 状态：已完成源码与聚焦验证；本地修改，未提交、未部署。
- 范围：App NoteIntakeScreen、只读确认 context 客户端、原任务 retry 防重放与必要 Jest/TS。
- 背景：旧任务无 model_source_snapshot 时空正文 retry 返回 409；模型选择器不能替代原任务绑定的明确确认。
- 合约来源：只读检查 app/routers/note.py 的 GET model-confirmation 与 POST retry、task_model_source.capture_source；本次不修改后台。
- 保留 owner / identity epoch / task / operation / generation Origin；上下文改变重新核对；未知写入只查询。服务地址不是凭证，拒绝含用户信息/查询参数的地址。
- 验证：6 suites / 58 tests 通过，Jest --runInBand；App tsc --noEmit exit 0。无真实请求、后台编辑、服务重启或原生构建。


## 完成行为与契约

- 旧任务 retry 收到明确 409 后打开 BottomActionSheet；后续通过“确认模型并恢复原任务”只读 GET context，不再重复空正文 POST。
- GET `/api/task/{task}/model-confirmation`：核对 task_id、source、requires_confirmation；需要确认时校验 can_confirm 与 mode=cloud/server_url/asr_model/llm_model。服务地址拒绝凭证、查询参数和非 HTTP(S)。无协议不允许确认。
- 展示绑定的原任务处理 Origin 与后台提供的模型服务、具体 ASR/LLM；明确说明旧模型无法确定，当前展示的是恢复选择。确认前重新 GET 对比全部字段及来源，并重新查询原任务状态。变化需再次核对，运行中/已保存只查询或打开结果。
- POST `/api/task/{task}/retry` 正文直接 `{confirmed:true, mode, server_url, asr_model, llm_model}`，不套 model_confirmation 字段。绑定 owner、identity epoch（同账号重新登录也失效）、task、operation、已记录 generation Origin；请求/持久化前后核对当前保存槽。原任务身份不替换。
- retryUncertain 在 POST 前持久化。未知传输/不完整或错误 task 的回执/保存回执失败只允许查询，重进也不重放。明确 400/401/403/404/409/422 拒绝才允许重新读取上下文并人工再确认。retry ACK 仅接收原 task_id 与已识别处理状态。
- 模型读取失败有原位 GET 重试；返回/loading 的关闭丢弃迟到响应；提交中关闭不启动其他操作；失败保留来源。已有快照的 false context 返回原任务，不能以确认替换已有模型。

## 修改路径

- src/screens/NoteIntakeScreen.tsx
- src/lib/noteIntake.ts（只增加 App 恢复标记类型）
- src/lib/intakeModelConfirmation.ts
- __tests__/NoteIntakeScreen.test.tsx
- __tests__/NoteIntakeScreen.models.test.tsx
- __tests__/intakeModelConfirmation.test.ts

## 证据与边界

新增 UI/协议用例涵盖 409、明确确认、loading 返回/迟到、失败 GET 重试、owner/ABA epoch/task/origin 切换、上下文变化、can_confirm=false、协议缺失、未知结果重新进入、任务转运行、显式拒绝、持久化失败、双击防重、迟到 ACK 不覆盖新来源；原恢复与历史用例仍通过。

未修改 backend/Desktop、未部署、未重启、未调用真实服务、未编译/安装 App；50 分钟原 Aliyun 任务未触碰。真实原生 Sheet 与远端确认接口的端到端验收尚未执行。公网 Feishu healthy 由父任务确认，与本次 mock 测试证据分开。
