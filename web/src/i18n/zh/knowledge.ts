/** Simplified Chinese for the knowledge strings, keyed by the English source text. */
export const zh: Record<string, string> = {
  // Page chrome (web/src/knowledge/KnowledgePages.tsx). Section bodies are in sections.zh.tsx.
  'FAQ': '常见问题',
  'Docs': '开发文档',
  'Whitepaper': '白皮书',
  'Guide': '使用指南',
  'Settings': '设置',
  'Sample mode': '示例体验',
  'Dashboard': '控制台',
  'Knowledge navigation': '知识库导航',
  'Print': '打印',
  'Knowledge garden': '知识花园',
  'Find your way around the little system.': '带你认识这个小小的系统。',
  'On this page': '本页内容',
  'Open dashboard': '打开控制台',
  'Open Sprout': '打开 Sprout',
  'See sample mode': '查看示例体验',
  'Sprout docs · technical draft v0.1 · 2026-09-14': 'Sprout 文档 · 技术草案 v0.1 · 2026-09-14',
  'Go to dashboard': '前往控制台',

  'Developer docs': '开发文档',
  'How the garden works': '花园是如何运转的',
  'A readable map of the contracts, backend, and browser app behind Sprout.': '一份易读的地图，介绍 Sprout 背后的合约、后端和浏览器应用。',
  'Technical draft': '技术草案',
  'A small system for growing ownership': '一个让所有权慢慢长大的小系统',
  'The current design, its boundaries, and the conditions that make each action possible.': '当前的设计、它的边界，以及每项操作得以执行的前提条件。',
  'Family guide': '家庭指南',
  'Start small. Grow together.': '从小处开始，一起成长。',
  'A straightforward path through the real Sprout experience, from sample mode to graduation.': '一条简单明了的路线，带你走完真实的 Sprout 体验：从示例体验一直到交接。',
  'Questions': '问答',
  'Good to know before you start': '开始之前，值得了解',
  'Where the money lives, when it can come out, what it costs, and what beta means.': '钱存在哪里、什么时候可以取出、要花多少钱，以及“测试版”意味着什么。',

  // The wallet-menu label the exit steps tell families to copy (components/PublicCa.tsx);
  // the guide and FAQ quote it as “这株小芽”.
  'This sprout': '这株小芽',

  // AutomationStatus (FAQ, "How does the money turn into stocks?")
  'A weekly plan buys automatically when the service is running automatic purchases; otherwise, run each week’s purchase with Invest now.':
    '当服务正在运行自动买入时，定投计划会自动买入；否则，请每周用“立即买入”完成当周的买入。',
  'Weekly plans run automatically: once a week the service buys the mix for you, as long as prices are fresh and the sprout has the money. You can still use Invest now at any time.':
    '定投计划会自动执行：只要价格是最新的，并且小芽里有足够的钱，服务每周会按配比替你买入一次。你仍然可以随时使用“立即买入”。',
  'Automatic weekly investing is switched off right now. You can still keep a weekly plan and run each week’s purchase with Invest now.':
    '每周自动定投目前已关闭。你仍然可以保留定投计划，并每周用“立即买入”完成当周的买入。',

  // ExitTokens (docs "exit" and guide "without-sprout")
  '{symbol} {address}, {decimals} decimals ({example})': '{symbol} {address}，{decimals} 位小数（{example}）',
  '{symbol} {address}, {decimals} decimals': '{symbol} {address}，{decimals} 位小数',
  '$5 is 5000000': '$5 即 5000000',
  '0.5 is 500000000000000000': '0.5 即 500000000000000000',

  // RiskList (FAQ "What are the risks?"): betaPoints() from components/BetaNotice.tsx
  'Transactions settle on Robinhood Chain mainnet with real funds and cannot be reversed.': '交易在 Robinhood Chain 主网上使用真实资金结算，无法撤销。',
  'The contracts have not been independently audited.': '合约尚未经过独立审计。',
  'Automatic weekly investing is switched off, so nothing invests on its own. Invest now buys from your wallet.': '每周自动定投目前已关闭，不会自动投资。“立即买入”会用你自己的钱包买入。',
  'Weekly plans run automatically from a service wallet; a run can be delayed or skipped when prices are stale.': '定投计划由一个服务钱包自动执行；价格过时的时候，某一次执行可能会推迟或被跳过。',
  'Graduation withdrawal has not yet been verified on mainnet.': '交接日后的提取功能尚未在主网上验证。',
  'Backup restoration has not yet been verified.': '备份恢复功能尚未经过验证。',
  'Balances and activity are read from the chain and can lag behind it.': '余额和动态从链上读取，可能滞后于链上的实际情况。',
  'Nothing here is financial advice.': '这里的任何内容都不构成投资建议。',
};
