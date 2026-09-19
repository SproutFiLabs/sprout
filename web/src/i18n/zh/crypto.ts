/**
 * The third asset batch: Bitcoin (CBBTC), Ethereum (WETH), Circle (CRCL) and
 * US Treasury bills (SGOV), with the crypto and cash-like groups, their guide
 * pages, baskets and crypto-aware wording. Tickers, basket codes and "cbBTC",
 * "WETH", "USDC" stay as they are (docs/I18N.md rule 4).
 */
export const zh: Record<string, string> = {
  // Stock picker groups, basket themes and guide themes (stocks.ts, StarterMixes.tsx, profiles.ts)
  Crypto: '加密货币',
  'Cash-like': '类现金',
  crypto: '加密货币',
  'cash-like Treasury bills': '类现金的短期国债',

  // Catalogue (stocks.ts): names and one-line descriptions
  Ethereum: '以太坊',
  'Ether, the coin of the Ethereum network': '以太币，以太坊网络的货币',
  Bitcoin: '比特币',
  'Bitcoin, held as Coinbase’s cbBTC token': '比特币，以 Coinbase 的 cbBTC 代币形式持有',
  Circle: 'Circle',
  'The company behind the USDC digital dollar': 'USDC 数字美元背后的公司',
  'US Treasury bills': '美国短期国债',
  'A fund of short-term loans to the US government': '一只投资于美国政府短期借款的基金',
  'a fund that lends to the US government|holding': '一只借钱给美国政府的基金',

  // Baskets (StarterMixes.tsx, perks/locks.ts)
  'Bitcoin & Ethereum': '比特币和以太坊',
  'Half Bitcoin, half Ethereum, the two biggest crypto coins. Crypto prices can swing hard, on any day of the week.':
    '比特币和以太坊各占一半，它们是规模最大的两种加密货币。加密货币的价格可能大起大落，一周七天都有可能。',
  'All in SGOV, a fund of short-term US Treasury bills. Its price moves very little; over long stretches it has usually grown more slowly than stocks.':
    '全部投入 SGOV，一只持有美国短期国债的基金。它的价格变动很小；从较长的时间来看，它的增长通常比股票慢。',
  'Crypto & Circle': '加密货币与 Circle',
  'Bitcoin, Ethereum and Circle, the company behind the USDC digital dollar. All three tend to rise and fall with crypto, and can swing hard.':
    '比特币、以太坊和 Circle（USDC 数字美元背后的公司）。三者往往随加密货币市场一起涨跌，波动可能很大。',

  // Stock guide kinds (profiles.ts)
  'Crypto coin': '加密货币',
  'Treasury bill fund': '短期国债基金',
  'Cash-like funds': '类现金基金',
  'Digital coins that live on blockchains, not pieces of a company. Their prices can swing hard, on any day of the week.':
    '存在于区块链上的数字货币，而不是一家公司的一部分。它们的价格可能大起大落，一周七天都有可能。',
  'One token that holds short-term loans to the US government. Its price moves very little.': '一个代币，持有借给美国政府的短期借款。它的价格变动很小。',

  // Stock guide entries (content.ts)
  'How investors feel about crypto overall': '投资者对加密货币的整体情绪',
  'Government rules for crypto': '政府对加密货币的监管规定',
  'Ether (ETH) is the coin of Ethereum, a worldwide network that runs apps and digital money without a company in charge. People pay small fees in ether to use it, and many other tokens and stablecoins live on it. Like Bitcoin, it is not a share in a business: its price is whatever buyers and sellers agree on.':
    '以太币（ETH）是以太坊的货币。以太坊是一个遍布全球的网络，运行着各种应用和数字货币，没有哪家公司说了算。人们使用它时要用以太币支付少量费用，许多其他代币和稳定币也运行在它上面。和比特币一样，它不是某家企业的股份：它的价格就是买卖双方谈成的价格。',
  'Ethereum is a giant shared computer on the internet, and ether is the coin people use to pay for it.':
    '以太坊就像互联网上一台大家共用的巨型电脑，以太币就是人们用来付费使用它的钱币。',
  'How many people use Ethereum and the apps built on it': '有多少人在使用以太坊和建立在它上面的应用',
  'WETH is wrapped ether: a token on Robinhood Chain that can be turned back into one ether, the same ETH that pays network fees there. It follows the price of ether one for one.':
    'WETH 是包装以太币（wrapped ether）：Robinhood Chain 上的一种代币，每一枚都可以换回一枚以太币，也就是在这条链上支付网络手续费的那种 ETH。它一比一地跟随以太币的价格。',
  'Bitcoin is the first and largest crypto coin: digital money with a fixed limit of 21 million coins, kept by a worldwide network of computers instead of a bank or a government. It is not a share in a business: its price is whatever buyers and sellers agree on, and it has had big swings both ways.':
    '比特币是第一种、也是规模最大的加密货币：一种总量固定为 2100 万枚的数字货币，由遍布全球的计算机网络共同维护，而不是由银行或政府管理。它不是某家企业的股份：它的价格就是买卖双方谈成的价格，而且涨跌都曾经非常剧烈。',
  'Bitcoin is digital money that no bank runs. There will only ever be 21 million of them.': '比特币是不由任何银行管理的数字货币。它永远只会有 2100 万枚。',
  'Big buyers and sellers, such as funds and companies': '基金和公司等大买家和大卖家',
  'In a sprout, Bitcoin is held as {registry} (cbBTC): Coinbase keeps one real bitcoin for every cbBTC, and the token is carried over to Robinhood Chain by Chainlink’s cross-chain bridge. So it relies on Coinbase and on that bridge, as well as on Bitcoin.':
    '在小芽里，比特币以 {registry}（cbBTC）的形式持有：每发行一枚 cbBTC，Coinbase 都保管着一枚真正的比特币，这种代币再通过 Chainlink 的跨链桥转到 Robinhood Chain 上。所以它除了依赖比特币本身，还依赖 Coinbase 和这座跨链桥。',
  'Circle issues USDC, one of the biggest stablecoins: a digital dollar meant to always be worth $1, backed by cash and short-term US government bonds. Most of Circle’s money is the interest earned on those reserves, so its income depends on how much USDC is in use and on interest rates. It is a company, not a coin.':
    'Circle 发行 USDC，这是规模最大的稳定币之一：一种旨在始终价值 1 美元的数字美元，以现金和美国政府短期债券作为支撑。Circle 的大部分收入来自这些储备资产赚取的利息，所以它的收入取决于 USDC 的使用量和利率。它是一家公司，不是一种货币。',
  'Circle makes USDC, a digital dollar people use to pay and save on the internet.': 'Circle 发行 USDC，一种人们在互联网上用来付款和存钱的数字美元。',
  'How much USDC people hold and use': '人们持有和使用多少 USDC',
  'Government rules for stablecoins': '政府对稳定币的监管规定',
  'SGOV (the iShares 0-3 Month Treasury Bond ETF) is a fund that holds US Treasury bills: loans to the US government that are paid back within three months. Because the loans are so short and the borrower is the US government, its price moves very little from day to day.':
    'SGOV（iShares 0-3 个月美国国债 ETF）是一只持有美国短期国债的基金：这些是借给美国政府、三个月内就会还清的借款。因为借款期限很短，借款人又是美国政府，所以它的价格每天的变动都很小。',
  'SGOV is like lending money to the US government for a few weeks and getting it back with a little extra.': 'SGOV 就像把钱借给美国政府几个星期，拿回来时还多了一点点。',
  'US Treasury bills paid back within three months. No companies.': '三个月内还清的美国短期国债。不含任何公司。',
  'US interest rates': '美国利率',
  'Demand for short-term government bonds': '市场对短期政府债券的需求',
  'The fund’s yearly fee': '基金每年收取的费用',

  // Stock guide pages (StockGuidePage.tsx)
  'A Treasury bill fund lends to one borrower, the US government, a few weeks at a time, so its price barely moves. It holds no companies, so it doesn’t rise when stocks rise.':
    '短期国债基金只把钱借给一个借款人，也就是美国政府，每次借几个星期，所以它的价格几乎不动。它不持有任何公司，所以股票上涨时它不会跟着涨。',
  'Already have a sprout? Open Portfolio and choose Edit allocation. Sprouts planted before Bitcoin, Ethereum, Circle and US Treasury bills were added can’t hold {symbol}: plant a new sprout for it.':
    '已经有小芽了？打开“投资组合”，选择“调整配比”。在比特币、以太坊、Circle 和美国短期国债加入之前种下的小芽不能持有 {symbol}：想持有它，请种下一株新的小芽。',
  'In a sprout, {symbol} is a token on Robinhood Chain that stands for the coin one for one. It isn’t a stock: no company’s shares are behind it, and it pays no interest or dividends.':
    '在小芽里，{symbol} 是 Robinhood Chain 上的一种代币，一比一地代表这种货币。它不是股票：背后没有任何公司的股份，也不支付利息或分红。',
  'Most of what a sprout can hold is one of two kinds.': '小芽能持有的东西，大多分为两类。',
  'SGOV is an ETF of short-term loans to the US government, so its price barely moves. Bitcoin and Ethereum are neither stocks nor funds: they are crypto coins, with no company behind them, and their prices can swing hard on any day of the week.':
    'SGOV 是一只投资于美国政府短期借款的 ETF，所以它的价格几乎不动。比特币和以太坊既不是股票也不是基金：它们是加密货币，背后没有公司，价格可能大起大落，一周七天都有可能。',
  'Basket of 1 token': '由 1 种代币组成',
  'A basket is a mix of separate tokens held directly in your sprout, not a fund of its own. Each holding keeps its own price, and you can change the mix later.':
    '股票篮是直接放在你的小芽里的几种独立代币的组合，本身并不是一只基金。每种持仓都有自己的价格，之后你也可以调整配比。',
  'Basket of {count} tokens': '由 {count} 种代币组成',

  // Diversification meter (diversification.ts)
  'Everything is in one crypto coin.': '全部在一种加密货币里。',
  'Everything is in US Treasury bills: short loans to one borrower, the US government.': '全部在美国短期国债里：借给同一个借款人（美国政府）的短期借款。',

  // Invest now (InvestNow.tsx): crypto prices update around the clock
  'The {symbol} price has not updated recently, so buying is paused to protect the price you get. Crypto prices normally update around the clock, so try again in a little while.':
    '{symbol} 的价格最近没有更新，为了保护你的成交价格，买入已暂停。加密货币的价格通常全天候更新，请稍后再试。',
  'Buying crypto tokens': '买入加密货币代币',
  'Buying stock and crypto tokens': '买入股票和加密货币代币',

  // Holding review (App.tsx)
  'crypto token': '加密货币代币',

  // Kid view (KidView.tsx)
  'Learn what moves this coin’s price': '看看是什么让这种货币的价格涨跌',

  // Exit guide (knowledge/sections.zh.tsx)
  'CBBTC (Bitcoin) has 8 decimals: 0.001 CBBTC is 100000. Wallets show it as cbBTC and WETH as WETH.':
    'CBBTC（比特币）有 8 位小数：0.001 CBBTC 就是 100000。钱包里显示为 cbBTC，WETH 则显示为 WETH。',
  'Buying paused while prices update: {symbols}.': '价格更新期间暂停购买：{symbols}。',
  'Current $100 quotes exceed the default price limit: {symbols}. Smaller purchases may differ.': '当前 100 美元报价超出默认价格限制：{symbols}。较小金额的结果可能不同。',
  'Market status unavailable: {symbols}.': '暂时无法获取市场状态：{symbols}。',
  'You can choose assets while markets are closed. Every asset must pass the price checks before a basket purchase can go through; no partial purchase is made.': '休市期间仍可选择资产。组合内每项资产均须通过价格检查后才能购买；不会只购买其中一部分。',
  'Live market status could not be confirmed. Prices are checked again before buying.': '暂时无法确认实时市场状态。购买前将再次检查价格。',
};
