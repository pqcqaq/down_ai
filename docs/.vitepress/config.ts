import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Down AI Agent Docs",
  description: "LaTeX academic revision agent development plan",
  lang: "zh-CN",
  cleanUrls: true,
  lastUpdated: true,
  markdown: {
    lineNumbers: true,
  },
  themeConfig: {
    siteTitle: "Down AI Agent",
    nav: [
      { text: "总览", link: "/" },
      { text: "开发计划", link: "/guide/development-plan" },
      { text: "架构", link: "/guide/architecture" },
      { text: "工作流", link: "/guide/agent-workflow" },
    ],
    sidebar: [
      {
        text: "规划文档",
        items: [
          { text: "项目总览", link: "/guide/overview" },
          { text: "开发计划", link: "/guide/development-plan" },
          { text: "Skill 集成", link: "/guide/skill-integration" },
          { text: "Agent 架构", link: "/guide/architecture" },
          { text: "可行性复核", link: "/guide/feasibility" },
          { text: "任务工作流", link: "/guide/agent-workflow" },
          { text: "前端计划", link: "/guide/frontend-plan" },
          { text: "后端接口", link: "/guide/backend-api-plan" },
          { text: "数据库设计", link: "/guide/database-plan" },
          { text: "数据与报告", link: "/guide/reporting-plan" },
          { text: "测试计划", link: "/guide/testing-plan" },
          { text: "安全与合规", link: "/guide/security-compliance" },
          { text: "里程碑", link: "/guide/roadmap" },
        ],
      },
    ],
    outline: {
      label: "本页目录",
      level: [2, 3],
    },
    search: {
      provider: "local",
      options: {
        locales: {
          root: {
            translations: {
              button: {
                buttonText: "搜索文档",
                buttonAriaLabel: "搜索文档",
              },
              modal: {
                noResultsText: "没有找到结果",
                resetButtonTitle: "清除查询",
                footer: {
                  selectText: "选择",
                  navigateText: "切换",
                  closeText: "关闭",
                },
              },
            },
          },
        },
      },
    },
    footer: {
      message: "规划文档用于指导后续实现，实际论文改写需保留人工审核。",
      copyright: "MIT Licensed",
    },
  },
});
