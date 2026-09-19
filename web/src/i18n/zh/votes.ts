/** Simplified Chinese for holder stock votes (perks/Votes.tsx), keyed by the English source text. */
export const zh: Record<string, string> = {
  'Holder votes': '持有者投票',
  'SPROUT holders choose which stock Sprout adds next. The more SPROUT a wallet has held, the more its vote counts.':
    'SPROUT 持有者投票决定 Sprout 下一只加入的股票。钱包持有的 SPROUT 越多，投票的分量就越重。',
  'Votes by tier: Seedling {seedling}, Sapling {sapling}, Bloom {bloom}, Grove {grove}.':
    '各等级的票数：幼苗 {seedling} 票，小树 {sapling} 票，花开 {bloom} 票，树林 {grove} 票。',

  // Tier names (Seedling, Sapling, Bloom, Grove) are in zh/perks.ts.

  // The viewer's standing
  'Connect the wallet that holds your SPROUT to vote.': '连接持有 SPROUT 的钱包即可投票。',
  'Hold SPROUT to vote': '持有 SPROUT 才能投票',
  'See how holder tiers work': '了解持有者等级',
  'Your holder tier is {tier}, so your vote counts {weight}.': '你的持有者等级是{tier}，你的一票计为 {weight} 票。',

  // The list
  'Votes could not be loaded. Please try again shortly.': '投票活动暂时无法加载，请稍后再试。',
  'No votes are open right now.': '目前没有进行中的投票活动。',
  'Recent results': '近期结果',
  'Closes {date}': '{date} 截止',
  'Closed {date}': '已于 {date} 截止',
  '1 holder voted': '1 位持有者已投票',
  '{count} holders voted': '{count} 位持有者已投票',
  'Tied': '并列第一',
  'Top choice': '得票最高',
  'Your vote': '你的投票',
  '{option}: {pct}% of the weighted vote': '{option}：占加权票数的 {pct}%',

  // Voting
  'Vote': '投票',
  'Voting…': '投票中…',
  'Voted': '已投票',
  'Change to this': '改投这个',
  'You voted for {option}. You can change your vote until the poll closes.': '你投给了 {option}。投票活动截止前，你可以随时改票。',
  'You voted for {option}.': '你投给了 {option}。',
  'Voting is for SPROUT holders.': '只有 SPROUT 持有者才能投票。',
  'This poll is not taking votes right now.': '这个投票活动现在不接受投票。',
  'Your wallet signature could not be checked. Please try again.': '无法验证你的钱包签名，请再试一次。',
  'Your vote was not counted: {reason}': '你的投票没有计入：{reason}',
};
