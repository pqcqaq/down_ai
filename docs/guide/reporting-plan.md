# 数据与报告计划

## 数据模型

### Task

```ts
type Task = {
  id: string;
  projectDir: string;
  reportFileId: string;
  state: TaskState;
  options: TaskOptions;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
};
```

### ReportFinding

```ts
type ReportFinding = {
  id: string;
  page?: number;
  rawText: string;
  normalizedText: string;
  riskType: string;
  severity: "low" | "medium" | "high";
  confidence: number;
  source: "pdf" | "manual" | "style_lint";
};
```

### LatexSegment

```ts
type LatexSegment = {
  id: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  sectionPath: string[];
  text: string;
  normalizedText: string;
  hash: string;
  protectedTokens: string[];
};
```

### RevisionRecord

```ts
type RevisionRecord = {
  id: string;
  taskId: string;
  segmentId: string;
  originalText: string;
  revisedText: string;
  revisionNote: string;
  status: "draft" | "approved" | "rejected" | "applied" | "failed";
  riskFlags: string[];
  validation: ValidationResult;
};
```

### ValidationResult

```ts
type ValidationResult = {
  protectedTokenOk: boolean;
  lengthDeltaRatio: number;
  languageOk: boolean;
  claimRisk: "none" | "low" | "medium" | "high";
  compileOk?: boolean;
  warnings: string[];
};
```

## Artifact 目录

建议每个任务创建独立 artifact 目录：

```text
.down-ai/
  tasks/
    task_001/
      task.json
      audit.json
      parsed-report.json
      revision-packet.json
      style-lint.json
      revisions.json
      apply-journal.json
      diff.patch
      report.md
      report.html
      report.json
      logs/
        agent.log
        tools.log
```

默认不提交 `.down-ai/` 到 Git。

## 统计指标

总览指标：

- PDF 命中总数。
- 成功匹配到 LaTeX 的数量。
- 已改写数量。
- 需人工复核数量。
- 已应用数量。
- 失败数量。
- protected token drift 数量。
- 编译是否通过。

分类指标：

- 按文件统计。
- 按章节统计。
- 按风险类型统计。
- 按严重程度统计。
- 按 Agent 处理状态统计。

质量指标：

- 平均长度变化。
- 高风险句占比变化。
- 中文风格 lint 命中变化。
- 人工拒绝率。
- 重新生成次数。

## 报告格式

### Markdown

适合存档和 Git diff：

```markdown
# 论文修订报告

## 总览

## 文件统计

## 命中明细

## 验证结果

## 人工复核项
```

### HTML

适合前端展示：

- 卡片式指标。
- 表格。
- 折叠详情。
- side-by-side diff。

### JSON

适合二次处理：

```json
{
  "summary": {},
  "findings": [],
  "revisions": [],
  "validation": {},
  "artifacts": {}
}
```

## 报告明细字段

每条 revision 明细包含：

- 文件路径。
- 起止行号。
- 原始文本。
- 修订文本。
- 问题类型。
- PDF 页码或来源。
- 匹配方法和分数。
- 修改说明。
- 风险标记。
- 校验结果。
- 是否已应用。

## 回滚记录

`apply-journal.json` 记录每个写入动作：

```json
{
  "filePath": "chapters/intro.tex",
  "beforeHash": "abc",
  "afterHash": "def",
  "patch": "...",
  "appliedAt": "2026-04-30T10:00:00.000Z"
}
```

回滚时按 journal 反向应用，回滚前再次校验当前 hash，避免覆盖用户后续手动修改。
