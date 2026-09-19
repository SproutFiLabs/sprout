/** Guardian wallets: the in-app Guardian view (GuardianView), its model and passkey messages. */
export const zh: Record<string, string> = {
  // Header and hero ('Your garden' lives in intelligence.ts)
  'MEET SPROUT GUARDIAN': '认识 SPROUT GUARDIAN',
  'A little backup.{br}For their {bigFuture}': '多一份保障，{br}守护孩子的{bigFuture}',
  'big future.': '大未来。',
  'A wallet with people in its corner.{br}Passkey approvals. A trusted circle. Time to act.':
    '一个有人撑腰的钱包。{br}通行密钥批准，可信的守护圈，还有应对的时间。',
  'Open your safety controls': '打开你的安全设置',
  'Build your safety circle': '组建你的守护圈',
  'Explore the protection': '看看有哪些保护',
  'Recovery requested · review your circle': '有人发起了恢复 · 请查看你的守护圈',
  'Published wallet code verified': '已验证：钱包代码与公开版本一致',
  'Optional protection for newly planted sprouts': '为新种下的小芽提供的可选保护',
  'GOOD THINGS DESERVE A LITTLE BACKUP.': '美好的事物，值得多一份保障。',

  // Feature cards
  '01 / APPROVE': '01 / 批准',
  'Your touch.{br}Your say.': '轻轻一按，{br}你说了算。',
  'Passkey approvals with your biometrics or device PIN. Revoke a credential when it’s time.':
    '用生物识别或设备 PIN 码，通过通行密钥批准。需要时，随时撤销凭证。',
  'P-256 PASSKEY VERIFICATION': 'P-256 通行密钥验证',
  '02 / TAKE A BREATH': '02 / 缓一缓',
  'A little time.{br}A lot of control.': '多一点时间，{br}多一分掌控。',
  'New destinations and over-budget transfers wait 24 hours. Time to review. Room to cancel.':
    '转到新地址或超出额度的转账，要等待 24 小时。有时间检查，也来得及取消。',
  'ON-CHAIN TRANSFER DELAYS': '链上转账延迟',
  '03 / FIND A WAY BACK': '03 / 找回来路',
  'Good people.{br}A way back.': '可靠的人，{br}一条回头路。',
  'Two of three guardians can approve recovery, followed by a 48-hour cancellation window.':
    '三位守护人中的两位即可批准恢复，之后还有 48 小时可以取消。',
  'QUORUM + TIMELOCK RECOVERY': '多数批准 + 时间锁恢复',

  // The circle of guardians
  'PEOPLE, NOT A PASSWORD RESET': '靠的是人，不是重置密码',
  'It takes a circle.': '靠大家一起守护。',
  'Choose three people with independent wallets. If access is lost, two can help restore it. One person can’t recover the wallet alone.':
    '选三位各自拥有独立钱包的人。如果失去了访问权限，其中两位就能帮你恢复。任何一个人都无法独自恢复这个钱包。',
  'Choose your circle': '选择你的守护圈',
  'Choose three independent recovery guardians': '选择三位互相独立的恢复守护人',
  '2 of 3': '3 选 2',
  'GUARDIAN RECOVERY': '守护人恢复',
  // Also used by GuardianPage's guardian address fields
  'Guardian {n}': '守护人 {n}',
  'Someone you trust': '你信任的人',

  // Safety controls
  'YOUR SAFETY CONTROLS': '你的安全设置',
  'Your Guardian wallet': '你的 Guardian 钱包',
  'Plant with this wallet': '用这个钱包种下小芽',
  'Wallet {address}': '钱包 {address}',
  'Owner {address}': '所有者 {address}',
  'Guardian sections': 'Guardian 功能分区',
  // Tabs, rendered as t(name)
  'Protection': '保护',
  'Recovery': '恢复',
  'Passkeys': '通行密钥',
  'Transfers': '转账',
  'Waiting for your approval or network confirmation…': '正在等待你的批准或网络确认…',
  'INSTANT TRANSFER BUDGET': '即时转账额度',
  'Remaining of {limit} {symbol}. Only trusted destinations qualify.':
    '这是 {limit} {symbol} 总额度中的剩余部分。只有转到可信地址的转账才能使用这项额度。',
  'Resets in {time}': '{time}后重置',
  'Window starts with your next instant transfer': '额度周期从你的下一笔即时转账开始计算',
  'Every route follows the rules.': '无论走哪条路，都要守同样的规则。',
  'Passkeys and the owner wallet share the same limits. Recovery replaces the owner and invalidates old passkeys, trusted destinations and pending transfers.':
    '通行密钥和所有者钱包共用同样的限额。恢复会更换所有者，并让旧的通行密钥、可信地址和待处理的转账全部失效。',
  'Review your recovery circle': '查看你的恢复守护圈',
  'Built for family control. Enforced by the wallet.': '为家庭掌控而设计，由钱包本身强制执行。',
  'Guardian is optional for new sprouts. Existing beneficiaries cannot be changed. On-chain addresses and activity remain public. This new wallet code has not been independently audited.':
    '新种下的小芽可以选择使用 Guardian。已有小芽的受益人无法更改。链上地址和活动记录依然公开。这套新的钱包代码尚未经过独立审计。',

  // Recovery panel
  'RECOVERY WITHOUT A SINGLE POINT OF CONTROL': '恢复不由任何一方单独掌控',
  'Your circle is coming together.': '你的守护圈正在聚齐。',
  'Access restored. A fresh start.': '访问权限已恢复，重新开始吧。',
  'A way back, when you need it.': '需要的时候，总有回头路。',
  '2 OF 3 + 48 HOURS': '3 选 2 + 48 小时',
  'Approved': '已批准',
  'Awaiting approval': '等待批准',
  'In your circle': '在你的守护圈中',
  'RECOVERY WINDOW': '恢复等待期',
  'GUARDIAN APPROVALS': '守护人批准',
  'OWNER ROTATED': '所有者已更换',
  'NO ACTIVE REQUEST': '没有进行中的请求',
  '{count} of 2': '{count} / 2',
  'Restored': '已恢复',
  'Ready if needed': '需要时随时可用',
  'Replacement owner: {address}': '新的所有者：{address}',
  'Old passkeys and pending transfers were invalidated. Register a new passkey.':
    '旧的通行密钥和待处理的转账已经失效。请重新添加通行密钥。',
  'Two guardians approve the replacement owner. The current owner has time to cancel.':
    '由两位守护人批准新的所有者。现任所有者有时间取消。',
  'Outgoing transfers pause while this recovery is active.': '这次恢复进行期间，所有转出都会暂停。',
  'Approve recovery': '批准恢复',
  'Complete recovery': '完成恢复',
  'Recovery is time-locked': '恢复尚在时间锁定期',
  'Cancel recovery': '取消恢复',
  'Guardians are public on-chain. Choose people with independent wallets. Two colluding guardians can recover control after the delay; keep your circle current.':
    '守护人在链上是公开的。请选择各自拥有独立钱包的人。如果两位守护人串通，等待期过后就能取得钱包的控制权；请及时更新你的守护圈。',

  // Passkeys panel
  'KEYS YOU CAN TURN OFF': '随时可以停用的钥匙',
  'One touch. Your approval.': '轻轻一按，由你批准。',
  'Use a passkey to approve transfers and claims. A connected wallet submits the transaction and pays gas.':
    '用通行密钥批准转账和领取。已连接的钱包负责提交交易并支付网络手续费。',
  'Add passkey': '添加通行密钥',
  'ACTIVE': '有效',
  'REVOKED / EXPIRED': '已撤销 / 已到期',
  'Passkey {n}': '通行密钥 {n}',
  'User verification required for every approval.': '每次批准都需要验证本人身份。',
  'This credential cannot authorize transactions.': '这个凭证无法授权交易。',
  'Revoke credential': '撤销凭证',
  'Old access cleared.': '旧的访问权限已清除。',
  'Your next approval can be a touch.': '下一次批准，轻轻一按就好。',
  'Add a passkey from the owner wallet. Recovery clears all previously enrolled credentials.':
    '请用所有者钱包添加通行密钥。恢复会清除之前添加的所有凭证。',
  'A synced passkey can exist on several devices. Revoking it disables every copy of that credential. Losing the Sprout domain does not remove owner-wallet or guardian recovery access.':
    '同步的通行密钥可能存在于多台设备上。撤销后，这个凭证的所有副本都会失效。即使失去 Sprout 域名，所有者钱包的访问权限和守护人恢复权限也不会因此失去。',

  // Countdown (model.ts countdown(), also shown by GuardianPage)
  'Ready to execute': '可以执行了',
  '{h}h {m}m': '{h} 小时 {m} 分钟',

  // Errors thrown by model.ts and passkey.ts, shown through t(error) in GuardianView
  'Enter an exact positive token amount.': '请输入一个准确的正数代币数量。',
  'Amount is outside the supported range.': '金额超出了支持的范围。',
  'Enter a valid nonzero wallet address.': '请输入一个有效的非零钱包地址。',
  'Choose three guardians.': '请选择三位守护人。',
  'Owner and guardians must be four different wallets.': '所有者和三位守护人必须是四个不同的钱包。',
  'This address does not match the published Sprout Guardian contract.': '这个地址与公开发布的 Sprout Guardian 合约不一致。',
  'Passkeys require a secure browser on HTTPS or localhost.': '通行密钥需要在安全的浏览器环境中使用（HTTPS 或 localhost）。',
  'Passkey creation cancelled': '已取消创建通行密钥',
  'This authenticator does not expose a P-256 public key.': '这个验证器没有提供 P-256 公钥。',
  'Invalid passkey public key': '通行密钥公钥无效',
  'Passkey approval cancelled': '已取消通行密钥批准',
  'Passkey challenge or origin mismatch': '通行密钥的挑战值或来源不匹配',
  'Unsupported passkey client data': '不支持这种通行密钥客户端数据',
  'Unsupported passkey signature encoding': '不支持这种通行密钥签名编码',
  'Invalid signature integer': '签名整数无效',
  'Invalid signature length': '签名长度无效',
  'Invalid signature value': '签名数值无效',
  'Trailing signature bytes': '签名末尾有多余的字节',
};
