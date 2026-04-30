# 任务计划：LaTeX 论文智能改写 Agent 开发规划

## 目标

在当前 `down_ai` 项目中创建 VitePress 文档子项目，形成一个面向后续开发的完整计划：结合 `../BypassAIGC-Skill` 的 LaTeX 审计、中文 AI 腔诊断、分段修订、protected token 校验能力，规划基于 TypeScript、Express、LangChain.js、前端页面和报告生成的自动化论文改写系统。

## 边界

- 当前任务只编写开发计划和文档，不实现业务代码。
- 文档表述为“降低模板化、机械化、泛化表达”，不承诺规避或通过任何 AI 检测器。
- 后续实际修改 LaTeX 时必须保护引用、公式、标签、环境、BibTeX、图表、算法和声明强度。

## 阶段

| 阶段 | 状态 | 内容 |
| --- | --- | --- |
| 1 | complete | 读取规划技能、LaTeX 改写技能和 `../BypassAIGC-Skill` 项目结构 |
| 2 | complete | 建立持久化规划文件 |
| 3 | complete | 创建 VitePress docs 子项目 |
| 4 | complete | 编写产品能力、Agent 架构和任务流水线计划 |
| 5 | complete | 编写前端、后端、报告、数据、安全与里程碑计划 |
| 6 | complete | 检查文档结构并输出总结 |
| 7 | complete | 复核架构与技术可行性，修正 DeepSeek/LangChain/数据库/解析层落地方案 |
| 8 | complete | 将开发计划收敛为 2-3 次迭代交付 |
| 9 | complete | Iteration 1：后端核心闭环实现 |
| 10 | complete | Iteration 2：前端工作台、写回和回滚 |
| 11 | complete | Iteration 3：真实 API 测试开关和任务恢复能力 |
| 12 | complete | 测试加固：真实场景 fixture、PDF 解析、API E2E、DeepSeek live 覆盖 |
| 13 | complete | 测试加固补充：真实 SkillRuntime 集成、危险写回拦截、live dry-run 数据库审计 |
| 14 | complete | 前端可用性加固：目录浏览、报告解析反馈、最近任务、批量审核、浏览器端完整验证 |
| 15 | complete | 前端降噪与真实 WiSh 验证：次级能力 modal 化、真实报告 live dry-run、正文文件选择修复 |
| 16 | complete | 报告驱动全局定位：遍历全部 `.tex` 段落，用报告前缀确定命中后再交给 AI 改写 |
| 17 | complete | 可见执行流：任务后台运行，前端实时显示当前阶段、阶段进度和最近事件 |
| 18 | complete | 移除前端数量上限：任务默认一次性处理全部报告命中段落 |

## 已知决策

- 文档子项目放在 `docs/`。
- 使用 VitePress 管理规划文档。
- Agent 计划以 LangChain.js 为主，保留 LangGraph 或队列工作流作为复杂任务编排升级方向。
- `../BypassAIGC-Skill` 作为可复用工具和提示词知识源，不直接复制为运行时代码的唯一来源。
- 当前任务新增的文档侧重开发规划，不实现后端 Agent 和前端应用代码。
- 数据库是任务、步骤、进度、事件、工具调用和 Agent 调用的事实来源，MVP 直接规划 SQLite + Drizzle ORM。
- 文件解析能力以 parser registry 形式接入，功能完整优先，可引入成熟依赖覆盖 PDF/OCR/LaTeX/BibTeX/DOCX/Markdown/压缩包/编译日志。
- 架构可行性已复核：第一版必须采用确定性 `TaskOrchestrator`，模型只产出结构化修订建议，不直接控制文件写入。
- DeepSeek 专有字段如 `thinking`、`reasoning_content` 不完全依赖 LangChain OpenAI wrapper，正式实现需要自定义 DeepSeek client/model adapter。
- 开发计划已改为 3 次主迭代；如需严格 2 次迭代，文档中有压缩方案。
- Iteration 1 开始前已确认工作区干净；规划文档已提交为 `0ac545a docs: add agent development plan`。
- Iteration 2 开始前已确认工作区干净；Iteration 1 已提交为 `611da45 feat: implement iteration 1 dry-run backend`。
- Iteration 3 开始前已确认工作区干净；Iteration 2 已提交为 `2e8dfeb feat: add revision workbench and apply flow`。
- 默认工作流应处理报告中所有确定命中的风险段落；前端不暴露数量上限，也不要求用户手工输入处理条数。
- 匹配策略改为全局搜索：先抽取项目内全部 `.tex` prose segment，再用报告 finding 的递减前缀定位唯一段落，最后才进入模型改写。
