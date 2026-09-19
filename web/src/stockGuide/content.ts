/**
 * The stock guide's words: what each asset is, a line for kids, and a few
 * things that tend to move its price. Plain, neutral and factual: no
 * predictions, no recommendations. English source text, translated with t()
 * where shown (Chinese in i18n/zh/stocks-guide.ts; web/test/stock-guide.test.ts
 * checks every string has one).
 */

export interface GuideEntry {
  /** What it is, for parents: two or three sentences. */
  what: string;
  /** One line for kids. */
  kids: string;
  /** Things that tend to move the price. */
  drivers: string[];
  /** Funds: what one token holds. */
  inside?: string;
  /** Anything to be precise about (what exactly the token follows). */
  note?: string;
  /** The registry's own name for what the token follows, quoted as is in `note`'s {registry} (config/stocks.json registryName). */
  registry?: string;
}

const D = {
  aiChips: 'Demand for AI chips',
  dataCenters: 'How much big tech spends on data centers',
  chipExports: 'Rules on selling chips to other countries',
  cloud: 'How much businesses spend on cloud computing',
  ads: 'How much companies spend on advertising',
  pcPhones: 'How many phones and computers people buy',
  memoryPrices: 'Memory chip prices, which rise and fall in cycles',
  usChina: 'Trade and relations between the US and China',
  rates: 'Interest rates',
  economy: 'How the US economy and company profits are doing',
  bigTechResults: 'How the biggest tech companies are doing',
  govRules: 'Government rules for big tech companies',
  aiSpending: 'How much the company spends on AI',
  growthMood: 'How much investors will pay for fast growth',
  cryptoMood: 'How investors feel about crypto overall',
  cryptoRules: 'Government rules for crypto',
} as const;

/** Every shared driver line (for the translation test). */
export const SHARED_DRIVERS: readonly string[] = Object.values(D);

export const GUIDE: Record<string, GuideEntry> = {
  AAPL: {
    what: 'Apple designs the iPhone, Mac, iPad and Apple Watch, and the software that runs on them. The iPhone is its biggest seller, and a growing share of its money comes from services such as the App Store, iCloud and Apple Music.',
    kids: 'Apple makes iPhones and Macs, and runs the App Store where you get apps and games.',
    drivers: ['How many iPhones people buy', 'Services like the App Store and iCloud', D.usChina],
  },
  MSFT: {
    what: 'Microsoft makes Windows and Office, and runs Azure, one of the biggest cloud computing services, which businesses rent to run their software and AI. It also owns LinkedIn and the Xbox games business.',
    kids: 'Microsoft makes Windows and Xbox, and the computers in the cloud that lots of apps run on.',
    drivers: [D.cloud, 'Demand for AI tools', 'Subscriptions to Office and Windows'],
  },
  GOOGL: {
    what: 'Alphabet is Google’s parent company. It runs Google Search, YouTube, Android and Google Cloud, and most of its money comes from ads shown next to searches and videos. The token follows Alphabet’s Class A shares (GOOGL).',
    kids: 'Google helps people search the internet, and it owns YouTube.',
    drivers: [D.ads, 'Competition from AI chat tools in search', D.cloud, D.govRules],
  },
  AMZN: {
    what: 'Amazon runs one of the world’s largest online stores and Amazon Web Services (AWS), a leading cloud computing business that other companies rent to run their apps. It also sells Prime memberships and advertising.',
    kids: 'Amazon delivers the things people order online, and rents out computers to other companies.',
    drivers: ['How much people shop online', D.cloud, 'The cost of delivering parcels'],
  },
  META: {
    what: 'Meta owns Facebook, Instagram, WhatsApp and Messenger. Almost all of its money comes from ads shown to the billions of people who use them, and it spends heavily on AI and on virtual reality headsets.',
    kids: 'Meta owns Instagram and WhatsApp, and makes its money from ads.',
    drivers: [D.ads, 'How many people use its apps', D.aiSpending, 'Privacy rules'],
  },
  NVDA: {
    what: 'NVIDIA designs graphics chips (GPUs). They started out as chips for video games and are now the main chips used to train and run AI in data centers, which is where most of NVIDIA’s money comes from. Other companies, such as TSMC, manufacture the chips it designs.',
    kids: 'NVIDIA designs the super-fast chips that power video games and AI.',
    drivers: [D.aiChips, D.dataCenters, D.chipExports],
  },
  AMD: {
    what: 'AMD designs processors and graphics chips for PCs, game consoles and data centers, including AI chips that compete with NVIDIA’s. Like NVIDIA, it designs chips and has them made by manufacturers such as TSMC.',
    kids: 'AMD designs the brains inside lots of computers and game consoles.',
    drivers: [D.aiChips, 'Sales of PCs and game consoles', 'Competition with NVIDIA and Intel'],
  },
  TSM: {
    what: 'TSMC (Taiwan Semiconductor Manufacturing) is the world’s largest contract chipmaker: it builds chips designed by companies such as Apple, NVIDIA and AMD in its factories, most of them in Taiwan. The token follows its shares listed in New York.',
    kids: 'TSMC is the factory that builds chips for Apple, NVIDIA and many others.',
    drivers: [D.aiChips, 'How many phones are sold', 'Relations between China, Taiwan and the US'],
  },
  ASML: {
    what: 'ASML, a Dutch company, builds the lithography machines chipmakers use to print tiny circuits onto silicon. It is the only maker of the most advanced ones, which use extreme ultraviolet (EUV) light.',
    kids: 'ASML builds giant machines that print chips, for the factories that make them.',
    drivers: ['How many new chip factories are being built', 'Rules on selling chip machines to other countries', D.aiChips],
  },
  MU: {
    what: 'Micron makes memory chips: DRAM, the working memory in computers and phones, and NAND flash for storage. AI servers need a lot of fast memory, so data centers are an ever bigger part of its business.',
    kids: 'Micron makes the memory chips that help computers remember things.',
    drivers: [D.memoryPrices, 'Demand for AI servers', D.pcPhones],
  },
  INTC: {
    what: 'Intel designs and makes processors for PCs and servers. Unlike most chip designers it runs its own factories, and it is building a business making chips for other companies too.',
    kids: 'Intel makes the brains inside lots of laptops and desktop computers.',
    drivers: ['How many PCs are sold', 'Competition with AMD and others', 'The cost of building chip factories'],
  },
  SNDK: {
    what: 'Sandisk makes flash memory and storage: memory cards, USB drives and the solid-state drives (SSDs) inside computers and data centers. It became a separate company again in 2025, when Western Digital split it off.',
    kids: 'Sandisk makes memory cards and drives that store photos, games and files.',
    drivers: [D.memoryPrices, 'Demand for storage in data centers', D.pcPhones],
  },
  PLTR: {
    what: 'Palantir makes software that helps governments and businesses bring their data together, find patterns and make decisions, more and more with AI. A large part of its business comes from US government and defense contracts.',
    kids: 'Palantir writes software that helps big organizations make sense of lots of information.',
    drivers: ['Government and defense spending', 'Businesses adopting AI software', D.growthMood],
  },
  TSLA: {
    what: 'Tesla makes electric cars, and batteries that store energy for homes and power grids. It is also working on self-driving software and robots.',
    kids: 'Tesla makes electric cars and giant batteries.',
    drivers: ['How many cars it delivers', 'Competition from other electric car makers', 'Progress on self-driving', 'News about its leadership'],
  },
  SPCX: {
    what: 'SpaceX builds and launches rockets and spacecraft that carry satellites, cargo and astronauts into space, and is developing Starship, a giant reusable rocket. It also runs Starlink, internet delivered by thousands of its own satellites.',
    kids: 'SpaceX builds rockets and runs Starlink, internet from space.',
    drivers: ['Launches and Starship test flights', 'How many people sign up for Starlink', 'Contracts with NASA and governments'],
    note: 'SPCX is Robinhood’s stock token for SpaceX. Robinhood’s token list names what it follows as {registry}. Like every token here, it follows that stock’s price; it is not a share registered in your name.',
    registry: 'Space Exploration Technologies Corp. Class A Common Stock',
  },
  BABA: {
    what: 'Alibaba runs China’s biggest online shopping sites, Taobao and Tmall, along with a large cloud computing business and online shops for other countries. The token follows its shares listed in New York.',
    kids: 'Alibaba runs huge online shops in China, a bit like Amazon.',
    drivers: ['How much people in China spend', 'Rules from the Chinese government', D.usChina],
  },
  GME: {
    what: 'GameStop sells video games, consoles and collectibles in its stores and online. In 2021 its stock became famous as a “meme stock”, when a rush of individual investors drove the price up very fast, and it has had big swings since.',
    kids: 'GameStop sells video games and consoles in its shops.',
    drivers: ['Sales of games and consoles', 'Buzz on social media among individual investors', 'Store closures and costs'],
  },
  SPY: {
    what: 'SPY (the SPDR S&P 500 ETF Trust) is a fund that holds the stocks in the S&P 500: about 500 large US companies, from Apple and NVIDIA to banks, supermarkets and oil companies. Bigger companies make up a bigger share of it, so the largest tech companies are a sizable part.',
    kids: 'One piece of SPY holds a tiny sliver of about 500 big US companies.',
    inside: 'About 500 large US companies from every industry, each in proportion to its size.',
    drivers: [D.economy, D.rates, 'The biggest companies in the index, which count the most'],
  },
  QQQ: {
    what: 'QQQ (Invesco QQQ) is a fund that follows the Nasdaq-100: about 100 of the largest companies listed on the Nasdaq stock exchange, leaving out banks and other financial companies. Many of them are tech companies, so it tends to move a lot like big tech.',
    kids: 'One piece of QQQ holds a sliver of 100 big companies, lots of them tech.',
    inside: 'About 100 of the largest non-financial companies on the Nasdaq, each in proportion to its size; big tech is a large part.',
    drivers: [D.bigTechResults, D.rates, D.aiChips],
  },
  SLV: {
    what: 'SLV (the iShares Silver Trust) is a fund that holds silver bars in vaults. Its price follows the price of silver, minus the fund’s yearly fee. Silver is used in jewelry and coins, and in electronics and solar panels.',
    kids: 'SLV is like owning a tiny bit of real silver kept in a vault.',
    inside: 'Silver bars held in vaults. No companies.',
    drivers: ['The price of silver', 'Demand from industry, such as solar panels and electronics', 'The US dollar and interest rates'],
  },
  USO: {
    what: 'USO (the United States Oil Fund) holds oil futures, contracts to buy oil at a set price on a future date, rather than barrels of oil. Its price moves with oil prices, but over months it can drift away from them, because the fund keeps swapping contracts that are about to expire for later ones.',
    kids: 'USO goes up and down with the price of oil, which petrol is made from.',
    inside: 'Futures contracts on US crude oil. No companies.',
    drivers: ['Oil prices', 'How much oil producing countries decide to pump', 'Travel and the world economy', 'Conflicts in oil producing regions'],
  },
  WETH: {
    what: 'Ether (ETH) is the coin of Ethereum, a worldwide network that runs apps and digital money without a company in charge. People pay small fees in ether to use it, and many other tokens and stablecoins live on it. Like Bitcoin, it is not a share in a business: its price is whatever buyers and sellers agree on.',
    kids: 'Ethereum is a giant shared computer on the internet, and ether is the coin people use to pay for it.',
    drivers: ['How many people use Ethereum and the apps built on it', D.cryptoMood, D.rates, D.cryptoRules],
    note: 'WETH is wrapped ether: a token on Robinhood Chain that can be turned back into one ether, the same ETH that pays network fees there. It follows the price of ether one for one.',
  },
  CBBTC: {
    what: 'Bitcoin is the first and largest crypto coin: digital money with a fixed limit of 21 million coins, kept by a worldwide network of computers instead of a bank or a government. It is not a share in a business: its price is whatever buyers and sellers agree on, and it has had big swings both ways.',
    kids: 'Bitcoin is digital money that no bank runs. There will only ever be 21 million of them.',
    drivers: [D.cryptoMood, 'Big buyers and sellers, such as funds and companies', D.rates, D.cryptoRules],
    note: 'In a sprout, Bitcoin is held as {registry} (cbBTC): Coinbase keeps one real bitcoin for every cbBTC, and the token is carried over to Robinhood Chain by Chainlink’s cross-chain bridge. So it relies on Coinbase and on that bridge, as well as on Bitcoin.',
    registry: 'Coinbase Wrapped BTC',
  },
  CRCL: {
    what: 'Circle issues USDC, one of the biggest stablecoins: a digital dollar meant to always be worth $1, backed by cash and short-term US government bonds. Most of Circle’s money is the interest earned on those reserves, so its income depends on how much USDC is in use and on interest rates. It is a company, not a coin.',
    kids: 'Circle makes USDC, a digital dollar people use to pay and save on the internet.',
    drivers: ['How much USDC people hold and use', D.rates, 'Government rules for stablecoins', D.cryptoMood],
  },
  SGOV: {
    what: 'SGOV (the iShares 0-3 Month Treasury Bond ETF) is a fund that holds US Treasury bills: loans to the US government that are paid back within three months. Because the loans are so short and the borrower is the US government, its price moves very little from day to day.',
    kids: 'SGOV is like lending money to the US government for a few weeks and getting it back with a little extra.',
    inside: 'US Treasury bills paid back within three months. No companies.',
    drivers: ['US interest rates', 'Demand for short-term government bonds', 'The fund’s yearly fee'],
  },
};

/** Every string in the guide, for the translation test. */
export function guideStrings(): string[] {
  return Object.values(GUIDE).flatMap((e) => [e.what, e.kids, ...e.drivers, ...(e.inside ? [e.inside] : []), ...(e.note ? [e.note] : [])]);
}
