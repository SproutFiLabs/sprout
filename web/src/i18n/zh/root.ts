/**
 * "Root your SPROUT" (让 SPROUT 扎根): the optional lock on /perks, the Rooted badge in the
 * wallet menu, and the rooted counter. Wording: only 锁定 (lock) or 扎根 (root). Never 质押,
 * 收益, 利息, 年化, 回报 or 奖励: rooting pays nothing; it only changes access and status.
 */
export const zh: Record<string, string> = {
  // Badge, counter, status line
  'Rooted 🌳': '已扎根 🌳',
  '{total} SPROUT rooted · {share} of supply': '已扎根 {total} SPROUT · 占总量 {share}',
  'SPROUT rooted, {share} of all SPROUT': 'SPROUT 已扎根，占全部 SPROUT 的 {share}',
  'Rooted: {locked} SPROUT, counting as {credit} · your tier counts {total} SPROUT':
    '已扎根：{locked} SPROUT，按 {credit} 计算 · 你的等级按 {total} SPROUT 计算',

  // The two paths and the warning
  'Two ways to reach a tier': '达到等级的两种方式',
  Hold: '持有',
  'Keep SPROUT in your wallet. It counts once you’ve held it for {period}, and you can move it any time.':
    '把 SPROUT 留在钱包里。持有满 {period}后开始计入，你随时可以转走。',
  'Root it (optional)': '让它扎根（可选）',
  'Lock SPROUT for 30, 90 or 180 days. It counts right away, and counts for more while it’s locked: ×1.25, ×1.5 or ×2.':
    '把 SPROUT 锁定 30、90 或 180 天。锁定后立即计入，锁定期间按更高倍数计算：×1.25、×1.5 或 ×2。',
  'Locked SPROUT can’t be withdrawn before the date you pick. Nobody, Sprout included, can unlock it early.':
    '锁定的 SPROUT 在你选定的日期之前无法提取。任何人（包括 Sprout）都不能提前解锁。',
  'Rooting only changes your access and status inside Sprout. It pays nothing, and you get back exactly the SPROUT you locked, to the same wallet.':
    '扎根只会改变你在 Sprout 内的权限和身份。它不支付任何东西；到期后，你锁定的 SPROUT 会原数退回同一个钱包。',

  // The lock form
  'Connect the wallet that holds your SPROUT to root some of it. You approve and lock from your own wallet, and only that wallet can withdraw it.':
    '连接持有 SPROUT 的钱包，即可让一部分扎根。授权和锁定都在你自己的钱包里完成，也只有这个钱包可以提取。',
  'How much SPROUT to lock': '要锁定多少 SPROUT',
  All: '全部',
  'Enter an amount of SPROUT, like 250,000.': '请输入 SPROUT 数量，例如 250,000。',
  'That’s more than this wallet holds ({amount} SPROUT).': '超过了这个钱包的持有量（{amount} SPROUT）。',
  'This wallet holds {amount} SPROUT.': '这个钱包持有 {amount} SPROUT。',
  'For how long': '锁定多久',
  'counts {multiplier}': '按 {multiplier} 计算',
  '{amount} SPROUT locked for {days} days counts as {credit} SPROUT toward your tier, starting now.':
    '锁定 {amount} SPROUT {days} 天，从现在起按 {credit} SPROUT 计入你的等级。',
  'Your tier after rooting: {tier}': '扎根后的等级：{tier}',
  'Unlocks on {date}. You can withdraw it then, not before.': '{date} 解锁。到那天才能提取，之前不行。',
  'Pick an amount and a length to see what it counts for (×{a}, ×{b} or ×{c} while locked).':
    '选择数量和时长，看看它能计为多少（锁定期间按 ×{a}、×{b} 或 ×{c} 计算）。',
  'I understand this SPROUT stays locked until {date}, and nobody can unlock it early.': '我明白这些 SPROUT 会锁定到 {date}，任何人都不能提前解锁。',
  'Approve and lock': '授权并锁定',
  'Step 1 of 2: approve in your wallet, so the lock can take exactly this amount.': '第 1 步（共 2 步）：在钱包里授权，让锁定合约只能取走这个数量。',
  'Step 1 of 2: waiting for the approval to confirm…': '第 1 步（共 2 步）：等待授权确认…',
  'Step 2 of 2: confirm the lock in your wallet.': '第 2 步（共 2 步）：在钱包里确认锁定。',
  'Step 2 of 2: waiting for the lock to confirm…': '第 2 步（共 2 步）：等待锁定确认…',
  'Rooted. Your SPROUT is locked and already counts toward your tier.': '已扎根。你的 SPROUT 已锁定，并已计入你的等级。',
  'You cancelled it in your wallet. Nothing was locked or moved.': '你在钱包里取消了。没有锁定或转走任何东西。',
  'That didn’t go through: {reason}': '没有成功：{reason}',

  // The wallet's locks
  'Your locks': '你的锁定',
  '{n} days · counts {multiplier} · unlocks {date}': '{n} 天 · 按 {multiplier} 计算 · {date} 解锁',
  '{n} days · unlocked {date} · counts as held SPROUT until you withdraw': '{n} 天 · 已于 {date} 解锁 · 提取前按持有的 SPROUT 计算',
  Locked: '锁定中',
  'Withdrawing…': '正在提取…',
  'Connect to withdraw': '连接钱包后提取',
  'After you withdraw, that SPROUT is back in your wallet and counts again once you’ve held it for {period}.':
    '提取后，这些 SPROUT 回到你的钱包，持有满 {period}后会重新计入。',
};
