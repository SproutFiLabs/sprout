/** SPROUT holder perks: the perks page, the tier row in the wallet menu, and the picker locks. */
export const zh: Record<string, string> = {
  // Tiers
  Seedling: '幼苗',
  Sapling: '小树',
  Bloom: '花开',
  Grove: '树林',
  'SPROUT tier': 'SPROUT 等级',
  'See holder perks': '查看持有者权益',
  'Checking…': '查询中…',
  'Holder perks': '持有者权益',

  // Perks page
  'SPROUT holder perks': 'SPROUT 持有者权益',
  'SPROUT holders': 'SPROUT 持有者',
  'Hold SPROUT, and your sprout gets more.': '持有 SPROUT，你的小芽能做的更多。',
  'Perks unlock inside Sprout for wallets that have held SPROUT for {days} days (24 hours during SPROUT’s first week). Nothing here moves money: what’s in a sprout still only ever goes to your child.':
    '钱包持有 SPROUT 满 {days} 天（SPROUT 上线第一周只需 24 小时）后，即可在 Sprout 内解锁权益。这里的一切都不会动用资金：小芽里的钱依然只会属于你的孩子。',
  'Your tier': '你的等级',
  'Loading the perks…': '正在加载权益…',
  'Holder perks aren’t switched on here yet.': '这里还没有开启持有者权益。',
  'Connect the wallet that holds your SPROUT to see your tier. Connecting only reads your address; nothing is signed.':
    '连接持有 SPROUT 的钱包即可查看你的等级。连接只会读取你的地址，不需要签名。',
  'Check my tier': '查看我的等级',
  'No browser wallet found. Open this page in the browser that has your wallet.': '没有找到浏览器钱包。请在装有钱包的浏览器中打开此页面。',
  'Checking your SPROUT…': '正在查询你的 SPROUT…',
  'Not a holder tier yet': '还没有达到持有者等级',
  'Held for the last {period}: {held} SPROUT · now: {now} SPROUT': '过去 {period}持有：{held} SPROUT · 当前：{now} SPROUT',
  'Keep holding: {tier} unlocks once you’ve held it for {period}.': '继续持有：满 {period}后即可解锁 {tier}。',
  '{n} days': '{n} 天',
  '{n} hours': '{n} 小时',
  'The tiers': '等级一览',
  '{amount} SPROUT': '{amount} SPROUT',
  Included: '包含',
  'Not included': '不包含',
  'Holder baskets': '持有者专属组合篮',
  'First dibs on new stocks': '新股票抢先买',
  'Automatic weekly investing': '自动每周定投',
  'Votes on the next stock': '为下一只股票投票',
  '{n}× vote': '{n} 倍票数',
  'When Sprout adds new stocks, holders ({tier} and up) can put them in their kid’s sprout first, for the first week.':
    'Sprout 上架新股票时，持有者（{tier}及以上）可以在第一周抢先把它们放进孩子的小芽。',
  'In early access now: {symbols}, until {date}.': '正在抢先开放：{symbols}，截至 {date}。',
  'Nothing in early access right now. The next batch of stocks goes to holders first.': '目前没有抢先开放的股票。下一批新股票会先向持有者开放。',
  '{n} baskets': '{n} 个组合篮',
  'One-tap baskets only holders can pick when planting or changing a sprout’s stocks. Each tier adds its own and keeps the ones below it.':
    '只有持有者能在种下小芽或调整股票时一键选用的组合篮。每个等级都会新增自己的组合篮，并保留更低等级的组合篮。',
  'A Sprout basket is a ready-made mix of up to five stocks, like a small ETF you can see inside. Your sprout holds the stocks themselves, not a fund.':
    'Sprout 组合篮是一份现成的配比，最多包含五只股票，就像一只里面装了什么都看得见的小型 ETF。小芽直接持有这些股票，而不是持有一只基金。',
  'Unlocked for you': '你已解锁',
  'Examples, not advice.': '仅为示例，不构成投资建议。',
  'Holders ({tier} and up) get weekly plans that run by themselves, with the network fees on Sprout. Everyone else runs each week with Invest now.':
    '持有者（{tier}及以上）的定投计划会自动执行，网络手续费由 Sprout 承担。其他用户每周用“立即买入”手动执行。',
  'Automatic investing isn’t switched on yet. When it is, holders get it first.': '自动定投还没有开启。开启后会先向持有者提供。',
  'Holders vote on which stock Sprout adds next. Higher tiers count more.': '持有者投票决定 Sprout 下一只上架的股票。等级越高，票数越多。',
  'Perks unlock features inside the Sprout app. They are not payments, rewards or financial advice, and they can change. The contracts stay open to everyone: holding SPROUT never changes who owns the money in a sprout.':
    '权益只是在 Sprout 应用内解锁功能，不是付款、奖励或投资建议，并且可能调整。合约对所有人开放：持有 SPROUT 永远不会改变小芽里的钱归谁所有。',
  'Questions? Read the {faq}.': '有疑问？请阅读{faq}。',

  // Picker locks and bouquets
  'SPROUT holders ({tier} and up) get {symbol} first, until {date}.': 'SPROUT 持有者（{tier}及以上）可抢先购买 {symbol}，截至 {date}。',
  'For SPROUT holders ({tier} and up).': '仅限 SPROUT 持有者（{tier}及以上）。',

  // Holder baskets (HOLDER_BOUQUETS in perks/locks.ts), by the tier that unlocks them. Company names as in the stock catalogue.
  Moonshots: '登月计划',
  'Tesla, SpaceX, Palantir, AMD and Micron. Bigger swings, both ways.': '特斯拉、SpaceX、Palantir、AMD 和美光。涨跌起伏都更大。',
  'AI Builders': 'AI 建造者',
  'The companies building AI: NVIDIA, Palantir, Microsoft, Meta and TSMC.': '正在打造 AI 的公司：英伟达、Palantir、微软、Meta 和台积电。',
  'Brands They Know': '孩子认识的品牌',
  'Apple, Amazon, Tesla, Meta and Google: names a kid already knows.': '苹果、亚马逊、特斯拉、Meta 和谷歌：孩子早就听说过的名字。',
  'Silver Lining': '一线银光',
  'Silver next to the S&P 500 and the Nasdaq-100.': '白银，加上标普 500 和纳斯达克 100。',
  'Behind the Chips': '芯片幕后',
  'The chip factories, machines and memory: TSMC, ASML, Intel, Micron and Sandisk. Chip stocks often rise and fall together.':
    '造芯片的工厂、机器和存储：台积电、阿斯麦、英特尔、美光和闪迪。芯片股常常一起涨、一起跌。',
  'Around the World': '放眼全球',
  'TSMC, ASML and Alibaba, big companies based outside the US, next to the S&P 500.': '台积电、阿斯麦和阿里巴巴这几家总部在美国以外的大公司，加上标普 500。',
  'Down to Earth': '脚踏实地',
  'Silver and oil next to the S&P 500. Silver and oil prices can jump or drop fast.': '白银和原油，加上标普 500。白银和原油的价格可能快速大涨或大跌。',
  'Game On': '游戏时间',
  'Microsoft, NVIDIA, AMD, Apple and GameStop: the consoles, chips, app store and shops behind the games kids play. GameStop’s price can swing hard.':
    '微软、英伟达、AMD、苹果和游戏驿站：孩子们玩的游戏背后的主机、芯片、应用商店和门店。游戏驿站的股价可能大起大落。',
  'Deep Roots': '深深扎根',
  'Mostly the S&P 500 and the Nasdaq-100, with a little Microsoft, Google and Amazon. It still falls when the market falls.':
    '以标普 500 和纳斯达克 100 为主，再加一点微软、谷歌和亚马逊。市场下跌时，它照样会跌。',
  'Wild Card': '过山车',
  'GameStop, SpaceX, Palantir, Sandisk and oil in one mix. Big swings, both ways.': '游戏驿站、SpaceX、Palantir、闪迪和原油放在一起。涨跌起伏都很大。',
};
