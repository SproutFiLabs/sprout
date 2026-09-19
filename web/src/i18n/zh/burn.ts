/**
 * "Buy & burn" (买入并销毁): the voluntary burn on /perks, the $1 offer after a buy, the
 * wallet-menu switch and the counters. Wording: only 买入并销毁 / 销毁. Never price talk or
 * gains: no 收益, 回报, 赚, 利润, 升值, 增值, 上涨, 暴涨, 拉盘, 通缩 or 奖励. It is voluntary,
 * it pays nothing, and it is not advice (不构成投资建议).
 */
export const zh: Record<string, string> = {
  // Titles and buttons
  'Buy & burn': '买入并销毁',
  'Buy & burn 🔥': '买入并销毁 🔥',
  'Buy & burn ${amount}': '买入并销毁 ${amount}',
  'Buy & burn $1 🔥': '买入并销毁 $1 🔥',
  'Not now': '暂时不用',
  'Stop asking': '不再询问',
  'View the transaction': '查看交易',

  // The panel on /perks
  'Anyone can spend a little USDG from their own wallet to buy SPROUT on the open market and burn it: it goes to the dead address, where nobody can ever move it again.':
    '任何人都可以从自己的钱包拿出一点 USDG，在公开市场买入 SPROUT 并销毁：它会被送到销毁地址，任何人都再也无法转走。',
  'This buys SPROUT on the open market with your USDG and burns it for good. It’s voluntary, it pays you nothing, and it’s not advice.':
    '这会用你的 USDG 在公开市场买入 SPROUT，并将其永久销毁。完全自愿，不会付给你任何东西，也不构成投资建议。',
  'Nothing comes out of any sprout, and no Sprout tool costs anything. Burning doesn’t change your tier.':
    '不会从任何小芽里拿钱，Sprout 的所有工具也都不收费。销毁不会改变你的等级。',
  'How much USDG to spend': '要花多少 USDG',
  'Amount in US dollars (USDG), ${min} to ${max}': '金额（美元，USDG），${min} 到 ${max}',
  'Enter an amount from ${min} to ${max}, like 10 or 12.50.': '请输入 ${min} 到 ${max} 之间的金额，例如 10 或 12.50。',
  'Connect the wallet you’ll pay from. You approve and send the burn from your own wallet.':
    '连接你要用来付款的钱包。授权和销毁交易都由你自己的钱包发出。',
  'Up to three wallet confirmations: two approvals for exactly this amount (skipped if your wallet already has them), then the buy & burn. Approvals made here are used up by the burn.':
    '最多需要在钱包里确认三次：两次只针对这个金额的授权（钱包里已经有的话会跳过），然后是买入并销毁。在这里做的授权会被这次销毁用完。',
  'Latest burns': '最近的销毁',
  'for ${usd}': '花费 ${usd}',

  // The quote
  'Getting a price…': '正在获取价格…',
  'Pick an amount to see how much SPROUT it burns.': '选择一个金额，看看能销毁多少 SPROUT。',
  '≈ {sprout} SPROUT will be burned': '将销毁约 {sprout} SPROUT',
  'If fewer than {floor} SPROUT would reach the dead address ({slippage} under this price), the burn is cancelled and no USDG is spent. The price includes the pool’s 2% trading fee.':
    '如果到达销毁地址的 SPROUT 少于 {floor}（比这个价格低 {slippage}），这次销毁会被取消，不会花掉任何 USDG。价格已包含资金池 2% 的交易手续费。',
  'Couldn’t get a price from the pool just now. Try again in a moment.': '暂时无法从资金池获取价格，请稍后再试。',

  // Steps and results
  'Checking the price and your wallet…': '正在核对价格和你的钱包…',
  'Step {n} of {total}: let Uniswap’s Permit2 use exactly {amount} of your USDG. Confirm in your wallet.':
    '第 {n} 步（共 {total} 步）：允许 Uniswap 的 Permit2 使用你恰好 {amount} 的 USDG。请在钱包中确认。',
  'Step {n} of {total}: waiting for the approval to confirm…': '第 {n} 步（共 {total} 步）：等待授权确认…',
  'Step {n} of {total}: let the Uniswap router spend that {amount}, for the next 30 minutes. Confirm in your wallet.':
    '第 {n} 步（共 {total} 步）：允许 Uniswap 路由合约在接下来 30 分钟内使用这 {amount}。请在钱包中确认。',
  'Step {n} of {total}: waiting for Permit2 to confirm…': '第 {n} 步（共 {total} 步）：等待 Permit2 确认…',
  'Step {n} of {total}: confirm the buy & burn in your wallet.': '第 {n} 步（共 {total} 步）：在钱包中确认买入并销毁。',
  'Step {n} of {total}: waiting for the burn to confirm…': '第 {n} 步（共 {total} 步）：等待销毁确认…',
  'Burned. {sprout} SPROUT went to the dead address for good.': '已销毁。{sprout} SPROUT 已永久送到销毁地址。',
  'Burned.': '已销毁。',
  'You cancelled it in your wallet. No USDG was spent.': '你在钱包里取消了。没有花掉任何 USDG。',
  'This wallet has {amount} USDG. Pick a smaller amount, or add USDG to this wallet first.':
    '这个钱包有 {amount} USDG。请选择更小的金额，或者先往这个钱包里转入 USDG。',
  'The price moved more than {floor} since the quote, so nothing was burned and no USDG was spent. Try again.':
    '报价之后价格变动超过 {floor}，所以没有销毁任何东西，也没有花掉 USDG。请再试一次。',

  // Counters
  'SPROUT burned via Sprout': 'SPROUT 已通过 Sprout 销毁',
  '{sprout} SPROUT burned via Sprout': '已通过 Sprout 销毁 {sprout} SPROUT',
  '{total} burned in total': '累计共销毁 {total}',

  // "Add a $1 burn to my buys"
  'Add a $1 burn to my buys': '每次买入后加一笔 $1 销毁',
  'After your own deposit or Invest now, we ask first. It’s paid from your wallet, never the sprout.':
    '在你自己存入资金或立即买入之后，我们会先问你。费用从你的钱包支付，绝不动用小芽里的钱。',
  'Add your $1 buy & burn?': '要加上你的 $1 买入并销毁吗？',
  'You asked to add a $1 burn to your buys. It spends $1 of USDG from your wallet, never from the sprout, to buy SPROUT and burn it.':
    '你设置了每次买入后加一笔 $1 销毁。它会从你的钱包（绝不是小芽）花 $1 的 USDG 买入 SPROUT 并销毁。',
};
