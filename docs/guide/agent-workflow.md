# 任务工作流

## 端到端流程

```text
1. 用户选择 LaTeX 项目目录
2. 用户上传或选择报告 PDF
3. 后端创建任务和工作目录
4. 写入数据库 `tasks`、`task_steps`、`task_events`
5. 审计 LaTeX 项目
6. 解析 PDF 报告
7. 全局抽取所有 `.tex` 文件中的可编辑 prose segment
8. 用报告命中内容的稳定前缀在全项目定位 LaTeX 段落
9. 中文/英文风格诊断
10. 生成改写计划
11. Agent 逐段生成 revised_text
12. 运行 revision packet lint
13. 人工确认或自动应用
14. 按文件写回 `.tex`
15. 运行 protected token 检查
16. 可选编译 LaTeX
17. 生成统计报告
```

## 输入校验

LaTeX 目录校验：

- 路径存在。
- 至少有一个 `.tex` 文件。
- 不在系统敏感目录。
- 不包含过大的二进制文件进入扫描范围。
- 用户有读写权限。

PDF 校验：

- 文件存在。
- 后缀为 `.pdf`。
- 大小在配置限制内。
- 可解析文本；如果不可解析，进入 OCR 或人工粘贴备用流程。

## 项目审计

调用：

```powershell
python ../BypassAIGC-Skill/scripts/latex_project_audit.py . --json audit.json
```

输出用于：

- 自动确定主文件。
- 找出章节文件。
- 记录引用和 label 风险。
- 决定是否允许自动应用。

如果发现重复 label 或大量 unresolved ref，任务不直接失败，但报告中标为高风险。

数据库写入：

- `tool_runs` 记录脚本调用。
- `artifacts` 记录 `audit.json`。
- `task_events` 写入 `step_started`、`step_completed` 或 `step_failed`。

## PDF 报告解析

报告解析分三层：

1. 文本抽取：提取每页文本。
2. 结构识别：识别命中段落、百分比、风险等级、批注。
3. 规范化：去掉空白、页眉页脚、报告模板噪声。

对不同报告格式使用 adapter：

```ts
type ReportParser = {
  name: string;
  supports(file: ParsedPdf): boolean;
  parse(file: ParsedPdf): ReportFinding[];
};
```

解析结果写入：

- `parsed_documents`
- `parsed_text_blocks`
- `report_findings`
- `artifacts`

## Segment 匹配

匹配策略以报告为主导，不再只处理某个 root tex：

1. 审计项目后遍历所有 `.tex` 文件，跳过 `dist`、`build`、`node_modules` 等目录。
2. 对每个文件生成 revision packet，并把所有 prose segment 写入 `latex_segments`。
3. 对每条报告 finding 取规范化后的前缀，按 `160/120/96/72/48/36/28/20` 字符递减搜索。
4. 若某个前缀只命中一个 segment，则认为定位确定。
5. 若前缀命中多个候选，再用 n-gram 相似度排序；只有最佳候选明显领先时才进入改写。
6. 兜底使用全局 n-gram 相似度，低置信度结果只写入 `finding_matches.needs_review=1`，不直接送模型。

匹配结果：

```ts
type MatchCandidate = {
  findingId: string;
  segmentId: string;
  score: number;
  method: "prefix_160" | "prefix_ranked_72" | "ngram_fallback";
  needsReview: boolean;
};
```

默认处理所有确定命中的风险段落；前端的数量限制只是成本保护开关，不是主工作流的一部分。

## Agent 前中后步骤

前置阶段：

- 校验输入和 SkillRuntime 可用性。
- 审计 LaTeX 项目并记录所有候选文件。
- 解析 PDF 报告并写入 `report_findings`。
- 全局抽取 prose segment 并写入 `latex_segments`。
- 根据报告前缀定位 segment，写入 `finding_matches`。

中置阶段：

- 对确定命中的 segment 调用 DeepSeek，要求结构化 JSON。
- 模型只输出 `RevisionDecision`，不直接写文件。
- 每次调用写入 `agent_runs`，修订草稿写入 `revisions`。

后置阶段：

- 校验 protected token、长度变化和风险标记。
- 人工确认后按文件重新生成 apply packet。
- 写回前运行 `lint_revision_packet.py`，写回后生成 diff、journal 和可回滚备份。
- 统计报告记录 finding 数、确定命中数、需复核匹配数、实际改写数。

## 风格诊断

中文论文优先调用：

```powershell
python ../BypassAIGC-Skill/scripts/chinese_ai_style_lint.py revision_packet.json --json --min-severity medium
```

诊断类型包括：

- 空泛价值判断。
- 机械目标链。
- 抽象名词堆叠。
- 固定序列套话。
- 过长技术清单。
- 对话式助手残留。
- 元话语。

诊断结果只作为修订优先级，不作为检测器预测。

## 改写计划

每个 segment 生成一个 `RevisionPlanItem`：

```ts
type RevisionPlanItem = {
  segmentId: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  originalText: string;
  findings: string[];
  styleIssues: string[];
  priority: "low" | "medium" | "high";
  mode: "keep" | "light_edit" | "rewrite" | "manual_review";
};
```

## 改写生成

对每个需要修改的 segment：

1. 调用 `render_revision_prompt.py` 生成受约束 prompt。
2. 注入报告命中原因和上下文。
3. 调用模型。
4. 要求返回结构化 JSON。
5. 写入 revision packet。

输出示例：

```json
{
  "segmentId": "intro-003",
  "action": "revise",
  "revisedText": "修订后的 LaTeX 正文",
  "revisionNote": "压缩空泛目标链，保留原引用和方法边界。",
  "riskFlags": [],
  "confidence": 0.86
}
```

每次模型调用写入 `agent_runs`，每条改写写入 `revisions`。如果模型输出无法解析为结构化 JSON，只记录失败事件，不写回 LaTeX。

## 应用与验证

应用前：

- `lint_revision_packet.py`
- 人工确认规则。
- 文件 hash 检查。

应用后：

- `latex_segmenter.py check`
- 可选 `latexmk`
- diff 生成。
- 报告生成。

验证结果写入 `validation_results`。应用成功后写入 `revisions.status=applied`，同时写入 `task_events` 和 `artifacts` 中的 diff/report 索引。

## 人工确认规则

进入人工确认的情况：

- 匹配置信度低。
- 改写长度变化超过阈值。
- protected token 有变化。
- 可能改变事实或结论强度。
- 涉及摘要、结论、实验结果、贡献声明。
- 模型返回非 JSON 或含解释性废话。

## 失败恢复

数据库是恢复依据，每个任务也可以导出 `task.json` 快照用于人工排查：

```json
{
  "id": "task_001",
  "state": "diagnosing_style",
  "completedSteps": ["audit", "parse_report", "build_revision_pack"],
  "artifacts": {}
}
```

失败后允许：

- 从最近完成阶段恢复。
- 跳过失败 segment。
- 切换到人工确认。
- 仅生成诊断报告，不写回文件。

## 数据库进度事件

每个长步骤必须持续写入进度事件：

```json
{
  "type": "step_progress",
  "stepKey": "matching_findings",
  "message": "已匹配 18 / 42 条报告命中",
  "payload": {
    "current": 18,
    "total": 42
  }
}
```

前端 SSE 只负责实时推送。SSE 断线后，前端通过 `GET /api/tasks/:taskId/events?after=<sequence>` 从数据库补齐事件。
