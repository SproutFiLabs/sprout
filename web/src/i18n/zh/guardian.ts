/** Guardian wallets (/guardian): recovery, passkeys, transfer limits and settings. */
export const zh: Record<string, string> = {
  'Opening Guardian…': '正在打开 Guardian…',

  // Status and errors
  'Public chain connection is not configured.': '尚未配置公共链连接。',
  'Wallet or network changed. Reconnect before approving a transaction.': '钱包或网络已变更。请重新连接后再批准交易。',
  'Chain configuration is loading.': '正在加载链配置。',
  'Chain connection is loading.': '正在建立链连接。',
  'Wallet connected. Check the account and action before signing.': '钱包已连接。签名前请核对账户和操作。',
  'Connect a wallet to approve and pay network gas.': '请连接钱包，用来批准操作并支付网络手续费。',
  'Wallet changed. Reconnect before signing.': '钱包已变更。请重新连接后再签名。',
  'Open a Guardian wallet first.': '请先打开一个 Guardian 钱包。',
  'Open a Guardian wallet.': '请打开一个 Guardian 钱包。',
  'Open your wallet first.': '请先打开你的钱包。',
  'Open a wallet.': '请打开一个钱包。',
  'Transaction submitted; reconnect to refresh this wallet.': '交易已提交；请重新连接以刷新这个钱包。',
  'Guardian bytecode and on-chain state verified.': '已验证 Guardian 字节码和链上状态。',
  'Guardian deployment did not succeed.': 'Guardian 部署未成功。',
  'Guardian created at {address}. Reconnect to open it.': 'Guardian 已创建，地址是 {address}。请重新连接后打开它。',
  'Guardian wallet created. Save its address, enroll a passkey, then choose it as the beneficiary of a new sprout.':
    'Guardian 钱包已创建。请保存它的地址，注册一个通行密钥，然后在种下新的小芽时把它选为受益人。',
  'This wallet’s passkeys were enrolled at {origin}. Use that origin or approve with the owner wallet.':
    '这个钱包的通行密钥是在 {origin} 注册的。请在该网址操作，或用所有者钱包批准。',
  'Wallet changed during passkey approval.': '用通行密钥批准时，钱包发生了变更。',
  'This sprout pays into your Guardian wallet.': '这株小芽会把钱付到你的 Guardian 钱包。',
  'This sprout has a different, fixed beneficiary. It cannot be reassigned.': '这株小芽有另一个固定的受益人，无法重新指定。',
  'Only the current owner can enroll a passkey.': '只有当前所有者可以注册通行密钥。',
  'Open the original enrollment domain to add passkeys.': '要添加通行密钥，请打开最初注册时使用的域名。',
  'Wallet changed. Enroll again.': '钱包已变更。请重新注册。',
  'Passkey enrolled for one year. The wallet enforces the same transfer rules for this credential.':
    '通行密钥已注册，有效期一年。钱包对这个凭证执行同样的转账规则。',

  // Create or open a Guardian wallet
  'Create a separate beneficiary wallet with three trusted guardians. The owner should be the person who will control the savings. The connected wallet pays deployment gas; Sprout never holds the signing keys.':
    '创建一个独立的受益人钱包，并选三位信任的守护人。所有者应当是将来掌管这笔储蓄的人。已连接的钱包支付部署所需的网络手续费；Sprout 从不持有签名密钥。',
  'Owner wallet': '所有者钱包',
  'Use the child’s wallet when they are the beneficiary. Guardian addresses must be different.':
    '如果孩子是受益人，请填孩子的钱包。守护人必须使用不同的地址。',
  'Instant transfer budget ({symbol} / 24 hours)': '即时转账额度（{symbol} / 24 小时）',
  'Initially only the owner’s address is trusted. Other transfers wait 24 hours.': '一开始只有所有者的地址是可信地址。其他转账要等待 24 小时。',
  'The recovery quorum is two of three. Changes to guardians, budgets or trusted destinations take 48 hours. The current owner can cancel a recovery request. Enrolling guardians publishes their wallet relationships on-chain.':
    '恢复需要三位守护人中的两位同意。更改守护人、额度或可信地址需要 48 小时。当前所有者可以取消恢复请求。登记守护人后，他们的钱包与这个钱包的关联会公开在链上。',
  'Create Guardian wallet': '创建 Guardian 钱包',
  'Already have a Guardian?': '已经有 Guardian 了？',
  'Guardian wallet address': 'Guardian 钱包地址',
  'Open wallet': '打开钱包',

  // Protection
  'Wallet link copied. The link reveals the public wallet address; it grants no signing access.':
    '钱包链接已复制。链接会显示公开的钱包地址，但不会给任何人签名权限。',
  'Copy wallet link': '复制钱包链接',
  'On-chain state refreshed.': '链上状态已刷新。',
  'Refresh status': '刷新状态',
  'Open another wallet': '打开另一个钱包',
  'Save this wallet address and share it with your guardians. Account access uses the connected owner wallet; guardian approvals use each guardian’s own wallet.':
    '请保存这个钱包地址，并发给你的守护人。账户操作使用已连接的所有者钱包；守护人批准时，各自使用自己的钱包。',

  // Recovery
  'Guardian approval confirmed on-chain.': '守护人的批准已在链上确认。',
  'Recovery complete. Old credentials and pending transfers are invalid. Connect the replacement owner wallet.':
    '恢复完成。旧的凭证和待处理的转账都已失效。请连接新所有者的钱包。',
  'Recovery cancelled by the current owner.': '当前所有者已取消恢复。',
  'Recovery requested. A second independent guardian must approve before the 48-hour delay begins.':
    '已发起恢复请求。必须再有一位独立的守护人批准，48 小时的等待期才会开始。',
  'Replacement owner wallet': '新所有者的钱包',
  'Verify the new address with the owner through a separate, trusted channel.': '请通过另一个可信的渠道，和所有者本人核实新地址。',
  'Start recovery': '发起恢复',
  'Connect one of the three guardian wallets to start recovery.': '请连接三位守护人之一的钱包，才能发起恢复。',

  // Passkeys
  'Credential revoked on-chain. All synced copies are disabled.': '凭证已在链上撤销。所有同步的副本都已停用。',

  // Transfers
  'TIME TO CHECK. TIME TO CANCEL.': '有时间核对，也有时间取消。',
  'Move money with a safety window.': '转账，留一段安全等待期。',
  'Instant sends require a trusted destination and enough budget. Queued sends wait 24 hours and can be cancelled by the owner or any guardian.':
    '即时转账必须发往可信地址，且额度足够。排队的转账要等待 24 小时，期间所有者或任何一位守护人都可以取消。',
  'RECOVERY HOLD': '恢复期暂停转出',
  '24-HOUR DELAY': '24 小时延迟',
  'Destination wallet': '收款钱包',
  'Amount ({symbol})': '金额（{symbol}）',
  'Approval method': '批准方式',
  'Passkey + gas-paying wallet': '通行密钥 + 支付手续费的钱包',
  'Transfer confirmed within the wallet’s budget.': '转账已在钱包额度内确认。',
  'Send within budget': '在额度内发送',
  'Transfer queued. The 24-hour cancellation window has started.': '转账已排队。24 小时的取消窗口已经开始。',
  'Queue for 24 hours': '排队 24 小时',
  'Transfer queue': '转账队列',
  'Transfer #{id} · {amount} {token}': '转账 #{id} · {amount} {token}',
  'raw token units': '原始代币单位',
  'To {address} · {status}': '发往 {address} · {status}',
  'Closed, expired or invalidated': '已关闭、已过期或已失效',
  'Token {address}': '代币 {address}',
  'Queued transfer executed.': '排队的转账已执行。',
  Execute: '执行',
  'Queued transfer cancelled.': '排队的转账已取消。',
  'No transfers queued.': '没有排队中的转账。',
  'Older requests': '更早的请求',
  'Latest requests': '最新的请求',
  'Cancel a transfer by ID': '按编号取消转账',
  'Showing the latest 20 requests. Unrecognized tokens are displayed in raw units. Contract requests bind the exact token, recipient and amount.':
    '显示最近 20 条请求。无法识别的代币以原始单位显示。合约里的请求锁定了确切的代币、收款人和金额。',
  'Transfer ID': '转账编号',
  'Enter a numeric transfer ID.': '请输入数字转账编号。',
  'Transfer cancelled.': '转账已取消。',
  'Cancel by ID': '按编号取消',
  'Claim rewards or withdraw a graduated sprout': '领取奖励，或提取已交接的小芽',
  'Sprout vault address': '小芽合约地址',
  'Check beneficiary & graduation': '检查受益人和交接日',
  'Linked to this Guardian. Graduation: {date}.': '已关联到这个 Guardian。交接日：{date}。',
  'Different beneficiary: this sprout cannot be moved into Guardian automatically.': '受益人不同：这株小芽无法自动转入 Guardian。',
  'Uses the {amount} {symbol} amount and approval method selected above. Proceeds enter this Guardian wallet; outward transfers still follow its policy.':
    '使用上方选择的金额（{amount} {symbol}）和批准方式。款项会进入这个 Guardian 钱包；往外转账时依然遵守它的规则。',
  'Allowance claimed into Guardian.': '零花钱已领取到 Guardian。',
  'Graduated savings received by Guardian. Transfer limits still apply.': 'Guardian 已收到交接的储蓄。转账限额依然有效。',
  'Receive graduated savings': '接收交接的储蓄',

  // Settings
  'YOUR CIRCLE CAN GROW WITH YOU': '你的守护圈可以和你一起长大',
  'Change the rules with time to review.': '修改规则，留出核对的时间。',
  'Only the current owner can propose and execute changes. A 48-hour delay gives existing guardians time to cancel. This is also how the beneficiary chooses their own recovery circle at graduation.':
    '只有当前所有者可以提议并执行变更。48 小时的等待期让现有守护人有时间取消。受益人交接时，也是这样选出自己的恢复圈。',
  'New {symbol} budget': '新的 {symbol} 额度',
  'Add trusted destination (optional)': '添加可信地址（可选）',
  'Policy change queued for 48 hours. Keep these values to execute the same change.':
    '规则变更已排队，需等待 48 小时。请保留这些数值，之后用来执行同一变更。',
  'Queue policy change': '提交规则变更',
  'Policy applied. New guardians and budget are active.': '规则已生效。新的守护人和额度已启用。',
  'Apply matching change': '执行相同的变更',
  'Pending policy change cancelled.': '待生效的规则变更已取消。',
  'Cancel pending change': '取消待生效的变更',
  'Pending change {hash} · {countdown}. Execution requires the exact proposed values.':
    '待生效的变更 {hash} · {countdown}。执行时必须使用与提议完全相同的数值。',
  'To tighten protection immediately, enter a lower budget above. The optional destination will be removed from trusted destinations.':
    '要立即收紧保护，请在上方填写更低的额度。填写的可选地址会从可信地址中移除。',
  'Immediate changes can only reduce the budget.': '立即生效的变更只能降低额度。',
  'Budget reduced and selected destination untrusted.': '额度已降低，所选地址已不再是可信地址。',
  'Tighten protection now': '立即收紧保护',
};
