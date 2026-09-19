/** Simplified Chinese for the kid strings, keyed by the English source text. */
export const zh: Record<string, string> = {
  // Kid view (KidView.tsx)
  '{name}’s sprout': '{name} 的小芽',
  'Your sprout': '你的小芽',
  'Just looking · nothing here moves money': '只能看看 · 这里不能动用任何钱',
  'We couldn’t find this sprout.': '我们没找到这株小芽。',
  'This sprout couldn’t be loaded just now.': '现在打不开这株小芽，请过一会儿再试。',
  'Taking a look…': '正在查看……',
  'Still growing': '还在长大',
  'is growing in your sprout.': '正在你的小芽里慢慢长大。',
  'Prices are resting right now, so we can’t add it up. Check back soon.': '价格正在休息，所以现在还算不出总数。过一会儿再来看看吧。',
  'What you own': '你拥有的东西',
  'Nothing yet. When money is added and invested, it shows up here.': '现在还什么都没有。钱存进来并投资以后，就会出现在这里。',
  'a little piece of {company}': '{company}的一小份',
  // Company names inside that phrase: 苹果 alone reads as the fruit.
  'Apple|holding': '苹果公司',
  'NVIDIA|holding': '英伟达公司',
  'Microsoft|holding': '微软公司',
  '500 big US companies|holding': '美国 500 家大公司',
  'a little piece of {ticker}': '{ticker} 的一小份',
  Apple: '苹果',
  NVIDIA: '英伟达',
  Microsoft: '微软',
  '500 big US companies': '美国 500 家大公司',
  'Learn about {name}': '了解{name}',
  'Learn about {ticker}': '了解 {ticker}',
  'waiting to be planted in stocks': '还在等着种进股票里',
  'Chores and rewards': '家务与奖励',
  'No chores waiting right now.': '目前没有待完成的家务。',
  'A chore': '一项家务',
  'earns {reward} when a grown-up says it’s done': '大人说做完了，就能得到 {reward}',
  'You have {amounts} of rewards ready to claim.': '你有 {amounts} 的奖励可以领取了。',
  '{first} and {second}': '{first} 和 {second}',
  Gifts: '礼物',
  'gift from family so far': '到现在为止，亲友送来的礼物',
  'gifts from family so far': '到现在为止，亲友送来的礼物',
  'When it’s yours': '什么时候变成你的',
  'It’s yours now': '现在是你的了',
  'to go, until {date}': '还要等这么久，直到 {date}',
  'since {date}': '从 {date}起',
  '{n} day': '{n} 天',
  '{n} days': '{n} 天',
  '{n} month': '{n} 个月',
  '{n} months': '{n} 个月',
  '{n} year': '{n} 年',
  '{n} years': '{n} 年',
  '{years} and {months}': '{years}零 {months}',
  'A grown-up looks after this sprout until the big day. Values go up and down.': '在大日子到来之前，会有一位大人照看这株小芽。它的价值会涨，也会跌。',

  // Learn (KidLearn.tsx)
  Learn: '学习',
  'Short lessons about what’s in your sprout. Answer the question at the end of each one to earn badges.':
    '这些小课很短，讲的是你的小芽里有什么。回答每节小课最后的问题，就能得到徽章。',
  'In your sprout': '在你的小芽里',
  Company: '公司',
  Basics: '基础知识',
  'You finished every lesson.': '你已经学完了所有小课。',
  '{n} more lesson to {badge}': '再学 {n} 节小课，就能得到{badge}徽章',
  '{n} more lessons to {badge}': '再学 {n} 节小课，就能得到{badge}徽章',
  'Finish a lesson to earn your first badge: {badge}': '学完一节小课，就能得到第一枚徽章：{badge}',
  '{badge} badge': '{badge}徽章',
  'No badge yet': '还没有徽章',
  '{done} of {n} lesson done': '共 {n} 节小课，已学完 {done} 节',
  '{done} of {n} lessons done': '共 {n} 节小课，已学完 {done} 节',
  Badges: '徽章',
  'all lessons': '全部小课',
  '{n} lesson': '{n} 节小课',
  '{n} lessons': '{n} 节小课',
  ', earned': '，已获得',
  ', not earned yet': '，还没获得',
  'Done|lesson': '已完成',
  'Not done yet': '还没完成',
  'These lessons are for learning, not financial advice.': '这些小课仅供学习，不构成投资建议。',
  'All lessons': '全部小课',
  'Your sprout holds {symbol}, so this lesson is about part of it.': '你的小芽里有 {symbol}，所以这节小课讲的就是其中的一部分。',
  'Try it': '试一试',
  'That’s right!': '答对了！',
  'You earned the {badge} badge.': '你得到了{badge}徽章！',
  'Lesson done.': '这节小课完成了。',
  'Not quite.': '不太对哦。',
  'Try another answer.': '再选一个试试吧。',
  'Next: {title}': '下一节：{title}',

  // Badge names (progress.ts). "Sprout" is also the brand, so each badge has its own key.
  'Seedling (badge)': '幼苗',
  'Sprout (badge)': '嫩芽',
  'Sapling (badge)': '小树',
  'Tree (badge)': '大树',

  // Lessons (lessons.ts): what is a share?
  'What is a share?': '什么是股票？',
  'A tiny piece of a company.': '公司的一小部分。',
  'Big companies are owned by lots of people. A share is one tiny piece of a company.': '大公司是由很多人一起拥有的。一股股票，就是一家公司里很小的一部分。',
  'Picture a company as a giant pizza cut into millions of slices. One share is one slice.': '把一家公司想象成一个超大的披萨，切成了几百万块。一股就是其中的一块。',
  'You can own part of a share, too, like a sliver of a slice. That’s why your sprout can show numbers like 0.04.':
    '你也可以只拥有一股的一部分，就像一块披萨上的一小条。所以你的小芽里会出现 0.04 这样的数字。',
  'A tiny piece of a company': '一家公司的一小部分',
  'A coupon for free things from a store': '商店送免费东西的优惠券',
  'Money you have to pay back': '要还回去的钱',
  'A share is a small piece of a company, like one slice of a very big pizza.': '一股股票就是一家公司的一小部分，就像超大披萨里的一块。',

  // Lessons: what your sprout really holds
  'What your sprout really holds': '你的小芽里到底有什么',
  'Tokens that follow the price of a share.': '跟着股票价格变化的代币。',
  'Your sprout doesn’t keep paper shares in a drawer. It holds stock tokens made by Robinhood: digital pieces built to follow the price of a real share.':
    '你的小芽不会把纸做的股票放在抽屉里。它拥有的是 Robinhood 做的股票代币：一种数字的小份额，设计成跟着一股真实股票的价格变化。',
  'When an Apple share gets more expensive, the Apple token does too. When the share gets cheaper, so does the token.':
    '一股苹果股票变贵了，苹果代币也会跟着变贵。股票变便宜了，代币也会变便宜。',
  'A token isn’t exactly the same as owning the share yourself. For example, it doesn’t give you a vote at the company’s meetings.':
    '拥有代币，和你自己拥有这股股票，并不完全一样。比如，代币不能让你在公司开会时投票。',
  'Money that hasn’t been planted in stocks yet waits as USDG, a digital dollar that is designed to stay worth $1.':
    '还没种进股票里的钱，会先变成 USDG 在那里等着。USDG 是一种数字美元，设计成一直值 1 美元。',
  'What does a stock token in your sprout do?': '你小芽里的股票代币会做什么？',
  'Stays at the same price forever': '价格永远不变',
  'Lets you run the company': '让你来管理这家公司',
  'Follows the price of a real share': '跟着一股真实股票的价格变化',
  'A stock token moves with the price of its share, up and down. It doesn’t put you in charge of the company.':
    '股票代币会跟着对应股票的价格一起涨跌。它不会让你来管理这家公司。',

  // Lessons: the big day
  'Why your sprout waits for the big day': '为什么小芽要等到大日子',
  'A savings jar that opens on one special date.': '一个只在特别日子才打开的存钱罐。',
  'Your sprout is like a savings jar with a lid that opens on one date: the big day. That date was picked when the sprout was planted, and it can’t be changed.':
    '你的小芽就像一个存钱罐，盖子只会在一个日子打开：那就是大日子。这个日子是种下小芽时选好的，不能更改。',
  'Until then, a grown-up looks after it. They can add money, plant it in stocks and set up chores. Nobody can take the money out early, except chore rewards once they’re ready for you.':
    '在那之前，由一位大人来照看它。大人可以往里面存钱、把钱种进股票里，还可以设置家务。谁都不能提前把钱拿出来，只有已经为你准备好的家务奖励除外。',
  'The wait keeps the money planted for years instead of being spent on something quick. On the big day, the sprout becomes yours.':
    '等待能让钱在里面种上好多年，而不是很快就花掉。到了大日子，小芽就是你的了。',
  'When does the sprout become yours?': '小芽什么时候变成你的？',
  'On any birthday you choose': '在你挑的任何一个生日',
  'On the big day picked when it was planted': '在种下它时选好的大日子',
  'Whenever a grown-up says so': '大人说可以的任何时候',
  'The big day was set when the sprout was planted, and it doesn’t move. That’s when the sprout becomes yours.':
    '大日子在种下小芽时就定好了，不会改变。到了那天，小芽就是你的了。',

  // Lessons: why prices go up and down
  'Why prices go up and down': '为什么价格会涨也会跌',
  'Buyers, sellers and news move prices every day.': '买的人、卖的人和新闻，每天都在让价格变化。',
  'A share’s price is what buyers and sellers agree on right now.': '一股股票的价格，就是买的人和卖的人此刻都同意的价格。',
  'When more people want a company’s shares, maybe because it made something popular, the price tends to rise. When more people want to sell, maybe after a hard year or worrying news, it tends to fall.':
    '想买一家公司股票的人变多时，价格往往会上涨，也许是因为这家公司做出了很受欢迎的东西。想卖的人变多时，价格往往会下跌，也许是因为它刚过完艰难的一年，或者出现了让人担心的新闻。',
  'Prices can change every day, sometimes a lot, and nobody knows for sure what comes next.': '价格每天都可能变化，有时变化很大。接下来会怎样，谁也说不准。',
  'What usually happens when many more people want a share than want to sell it?': '想买一只股票的人，比想卖的人多很多时，通常会发生什么？',
  'The price never changes': '价格永远不变',
  'The price drops to zero': '价格跌到零',
  'The price tends to go up': '价格往往会上涨',
  'More people wanting a share pushes the price up. More people selling pushes it down.': '想买的人多了，价格会被推高。想卖的人多了，价格会被压低。',

  // Lessons: eggs in one basket
  'Don’t put all your eggs in one basket': '别把鸡蛋都放在一个篮子里',
  'Why spreading out can help.': '为什么分散开会有帮助。',
  'If you carry all your eggs in one basket and drop it, they might all break. Spread them across a few baskets and one slip won’t break them all.':
    '如果你把鸡蛋全放在一个篮子里，篮子一掉，鸡蛋可能全都碎了。把它们分到几个篮子里，就算失手一次，也不会全碎。',
  'Owning pieces of different companies works the same way. If one company has a hard year, others might be doing fine.':
    '拥有不同公司的一小部分，也是一样的道理。如果一家公司这一年过得很艰难，别的公司可能还不错。',
  'Spreading out doesn’t stop values from falling, but it means one company’s bad luck matters less.': '分散开并不能阻止价值下跌，但能让一家公司的坏运气影响小一些。',
  'Why might someone own pieces of several companies instead of one?': '为什么有人会拥有好几家公司的一小部分，而不是只拥有一家？',
  'So one company’s bad year matters less': '这样一家公司过得不好时，影响会小一些',
  'So prices can only go up': '这样价格就只会上涨',
  'Because owning one company isn’t allowed': '因为不允许只拥有一家公司',
  'Spreading out means trouble at one company hurts less. It can’t stop all the ups and downs, though.': '分散开来，一家公司出了问题，伤害就会小一些。不过，它挡不住所有的涨涨跌跌。',

  // Lessons: time and patience
  'Time and patience': '时间和耐心',
  'Small amounts, many years, and honest ups and downs.': '小钱、很多年，还有真实的涨涨跌跌。',
  'Small amounts added again and again can add up over the years. If the companies grow, the pieces you own can be worth more, and growth can build on earlier growth.':
    '一次又一次存进去的小钱，过了很多年可能会积少成多。如果这些公司在成长，你拥有的那一小部分就可能更值钱。而且，新的增长还可以在之前的增长上继续叠加。',
  'But it isn’t a promise. Values can fall, sometimes for a long time, and a sprout can end up worth less than what was put in.':
    '但这不是保证。价值可能会下跌，有时会跌很久。小芽最后的价值，也可能比投入的钱还少。',
  'Checking every day can feel like a roller coaster. Looking across years instead of days shows the bigger picture.':
    '如果每天都去看，可能会觉得像在坐过山车。按年来看，而不是按天来看，才能看到更完整的样子。',
  'Which is true about saving small amounts for many years?': '关于很多年一直存小钱，下面哪句话是对的？',
  'It always doubles every year': '它每年总会翻一倍',
  'Only big amounts can grow': '只有大钱才会增长',
  'It can add up, but values can also fall': '可能会积少成多，但价值也可能下跌',
  'Small amounts can add up over time, but nothing is certain. Values can go down as well as up.': '小钱随着时间可能会积少成多，但没有什么是一定的。价值会涨，也会跌。',

  // Lessons: gifts and chore rewards
  'Gifts and chore rewards': '礼物和家务奖励',
  'What each one does to your sprout.': '它们各自会让你的小芽发生什么变化。',
  'When family sends a gift with a gift link, it adds more to your sprout. It can be planted in stocks and grow along with everything else.':
    '亲友用礼物链接送来礼物时，你的小芽里就会多一些钱。这些钱可以种进股票里，和小芽里的其他东西一起成长。',
  'A chore reward works the other way around. A grown-up sets aside some of what’s already in your sprout for a chore. Once they say it’s done, you can claim the reward and use it now.':
    '家务奖励正好反过来。大人会从小芽里已有的东西中，拿出一部分留给一项家务。等大人说你做完了，你就可以领取这份奖励，马上就能用。',
  'Whatever you claim leaves the sprout, so it stops growing there. Now or later is a good thing to talk about with your grown-up.':
    '你领取的东西会离开小芽，也就不会在里面继续长大了。现在就用，还是以后再用？这是个值得和大人聊一聊的好问题。',
  'What does a gift from family do to your sprout?': '亲友送的礼物会让你的小芽怎么样？',
  'Opens it before the big day': '让它在大日子之前打开',
  'Adds more to it': '让里面变得更多',
  'Takes money out of it': '从里面拿走钱',
  'A gift adds to your sprout so it has more that can grow. It doesn’t change the big day.': '礼物会让你的小芽里多一些东西，能长大的就更多了。它不会改变大日子。',

  // Lessons: Apple
  'The company behind the iPhone and the Mac.': '做 iPhone 和 Mac 的公司。',
  'Apple makes the iPhone, the Mac, the iPad and the Apple Watch.': '苹果公司做 iPhone、Mac、iPad 和 Apple Watch。',
  'It also runs services that people pay for, like the App Store, Apple Music and iCloud storage for photos and files.':
    '它还提供一些要付钱的服务，比如 App Store、Apple Music，还有用来存照片和文件的 iCloud 储存空间。',
  'When people pick Apple products and services, that money goes to the company. How well Apple does, and how people feel about its future, both help decide what an Apple share is worth. That can go up or down.':
    '人们选择苹果的产品和服务时，花的钱就会付给这家公司。苹果经营得好不好，还有人们怎么看它的未来，都会影响一股苹果股票值多少钱。这个价值可能会涨，也可能会跌。',
  'Which of these does Apple make?': '下面哪一个是苹果公司做的？',
  'The Xbox': 'Xbox',
  'The iPhone': 'iPhone',
  Windows: 'Windows',
  'Apple makes the iPhone. The Xbox and Windows come from Microsoft.': 'iPhone 是苹果公司做的。Xbox 和 Windows 来自微软。',

  // Lessons: NVIDIA
  'A company that designs chips for games, graphics and AI.': '一家为游戏、图形和 AI 设计芯片的公司。',
  'NVIDIA designs computer chips. Its best-known chips are GPUs (graphics processing units), which draw the pictures you see in video games.':
    '英伟达设计电脑芯片。它最有名的芯片叫 GPU（图形处理器），能画出你在电子游戏里看到的画面。',
  'GPUs are very good at doing lots of small math problems at the same time. That makes them useful for graphics, video and artificial intelligence (AI), which needs a huge amount of math.':
    'GPU 很擅长同时做很多道小数学题。所以它们很适合用在图形、视频和人工智能（AI）上，因为人工智能需要做大量的计算。',
  'NVIDIA designs the chips, and factories run by other companies usually build them.': '芯片由英伟达设计，通常由其他公司的工厂来制造。',
  'What are NVIDIA’s GPUs used for?': '英伟达的 GPU 是用来做什么的？',
  'Making sneakers': '做运动鞋',
  'Delivering packages': '送快递',
  'Games, graphics and AI': '游戏、图形和 AI',
  'NVIDIA designs GPUs, chips that draw game graphics and do the math behind AI.': '英伟达设计 GPU。GPU 是一种芯片，能画出游戏画面，也能做人工智能背后的计算。',

  // Lessons: Microsoft
  'Windows, Office, Xbox and cloud computing.': 'Windows、Office、Xbox 和云计算。',
  'Microsoft makes Windows, which runs on lots of computers, and Office apps like Word, Excel and PowerPoint.':
    '微软做了 Windows，很多电脑上都在用它。微软还做了 Office 软件，比如 Word、Excel 和 PowerPoint。',
  'It makes the Xbox game console, and it owns the studio behind Minecraft.': '它还做了 Xbox 游戏机，而且拥有开发《我的世界》（Minecraft）的工作室。',
  'A big part of its business is cloud computing: other companies rent Microsoft’s powerful computers over the internet instead of running all of their own.':
    '它有一大块生意是云计算：别的公司通过互联网租用微软强大的电脑，而不用全靠自己的电脑。',
  'What is cloud computing?': '什么是云计算？',
  'Using powerful computers over the internet': '通过互联网使用强大的电脑',
  'Computers that float in the sky': '飘在天上的电脑',
  'A way to forecast the weather': '一种预报天气的方法',
  'Cloud computing means using computers in big data centers over the internet, like Microsoft’s.': '云计算就是通过互联网，使用大型数据中心里的电脑，比如微软的那些。',

  // Lessons: SPY
  'SPY: lots of companies at once': 'SPY：一次拥有很多家公司',
  'One piece holds a sliver of about 500 big US companies.': '一份 SPY 就包含大约 500 家美国大公司的一小部分。',
  'SPY isn’t one company. It’s a fund that follows the S&P 500, a list of about 500 large companies in the United States.':
    'SPY 不是一家公司，而是一只基金。它跟随标普 500，也就是一份大约有 500 家美国大公司的名单。',
  'One piece of SPY holds a tiny sliver of all of those companies at once, including Apple, NVIDIA and Microsoft.':
    '一份 SPY 同时包含所有这些公司的一小部分，其中就有苹果、英伟达和微软。',
  'Because it is spread across so many companies, one company’s bad day matters less to SPY. When most companies fall together, SPY falls too.':
    '因为它分散在这么多家公司里，一家公司某天表现不好，对 SPY 的影响就小一些。但如果大多数公司一起下跌，SPY 也会跟着跌。',
  'What does one piece of SPY hold?': '一份 SPY 里有什么？',
  'A piece of just one company': '只有一家公司的一小部分',
  'A sliver of about 500 companies': '大约 500 家公司的一小部分',
  'Only dollars': '只有美元',
  'SPY follows the S&P 500, so each piece holds a little bit of about 500 large US companies.': 'SPY 跟随标普 500，所以每一份都包含大约 500 家美国大公司的一点点。',
};
