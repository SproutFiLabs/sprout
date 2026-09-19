import { ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';
import { useAutomationEnabled } from '../automationStatus';
import { betaPoints } from '../components/BetaNotice';
import { tierName, useAutoInvestTier } from '../perks/autoInvest';
import { t, tj } from '../i18n';
import { displayName } from '../stocks';

/*
 * The Simplified Chinese knowledge pages, plus the small building blocks both
 * languages share. The shared pieces live here rather than in KnowledgePages.tsx
 * so this file never imports that one (no circular import).
 *
 * Every section keeps the English id, order, links, code, function names and
 * addresses. Risk and exit wording is translated exactly: nothing softened,
 * nothing added or dropped.
 */

export type Section = { id: string; eyebrow?: string; title: string; body: ReactNode };

export const SOURCIFY_VAULT = 'https://repo.sourcify.dev/4663/0x789ca950BAE92f4c18f5eBf776d54d85a0fF9A59';

export function Code({ children }: { children: ReactNode }) { return <code className="knowledge-code">{children}</code>; }

export function Callout({ children, tone = 'green' }: { children: ReactNode; tone?: 'green' | 'orange' }) { return <aside className={`knowledge-callout knowledge-callout--${tone}`}>{children}</aside>; }

/** The beta risk list, with the automation line taken from the server. betaPoints() already translates. */
export function RiskList() {
  const enabled = useAutomationEnabled();
  return <ul>{betaPoints(enabled).map((point) => <li key={point}>{point}</li>)}</ul>;
}

/** Reports the server's actual automation status instead of a fixed claim. */
export function AutomationStatus() {
  const enabled = useAutomationEnabled();
  const perkTier = useAutoInvestTier();
  if (enabled === null) return <p>{t('A weekly plan buys automatically when the service is running automatic purchases; otherwise, run each week’s purchase with Invest now.')}</p>;
  if (enabled && perkTier) return <p>{t('Weekly plans run automatically for SPROUT holders ({tier} and up): once a week the service buys the mix for you, as long as prices are fresh and the sprout has the money. Anyone can keep a weekly plan and run each week’s purchase with Invest now.', { tier: tierName(perkTier) })} <a href="/perks">{t('See SPROUT perks')}</a></p>;
  return enabled
    ? <p>{t('Weekly plans run automatically: once a week the service buys the mix for you, as long as prices are fresh and the sprout has the money. You can still use Invest now at any time.')}</p>
    : <p>{t('Automatic weekly investing is switched off right now. You can still keep a weekly plan and run each week’s purchase with Invest now.')}</p>;
}

/**
 * What a family needs to reach a sprout without this website
 * (docs/EXIT-WITHOUT-SPROUT.md): the cash token and every stock token a sprout
 * can hold, from config/stocks.json (web/test/stocks.test.ts keeps them in step).
 * Sprouts planted before the list grew hold only USDG, AAPL, NVDA, MSFT and SPY.
 */
export const EXIT_TOKENS: ReadonlyArray<{ symbol: string; address: string; decimals: number }> = [
  { symbol: 'USDG', address: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168', decimals: 6 },
  { symbol: 'AAPL', address: '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9', decimals: 18 },
  { symbol: 'NVDA', address: '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC', decimals: 18 },
  { symbol: 'MSFT', address: '0xe93237C50D904957Cf27E7B1133b510C669c2e74', decimals: 18 },
  { symbol: 'SPY', address: '0x117cc2133c37B721F49dE2A7a74833232B3B4C0C', decimals: 18 },
  { symbol: 'TSLA', address: '0x322F0929c4625eD5bAd873c95208D54E1c003b2d', decimals: 18 },
  { symbol: 'SPCX', address: '0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa', decimals: 18 },
  { symbol: 'AMZN', address: '0x12f190a9F9d7D37a250758b26824B97CE941bF54', decimals: 18 },
  { symbol: 'GOOGL', address: '0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3', decimals: 18 },
  { symbol: 'META', address: '0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35', decimals: 18 },
  { symbol: 'PLTR', address: '0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A', decimals: 18 },
  { symbol: 'AMD', address: '0x86923f96303D656E4aa86D9d42D1e57ad2023fdC', decimals: 18 },
  { symbol: 'TSM', address: '0x58FfE4a942d3885bAa22D7520691F611EF09e7AA', decimals: 18 },
  { symbol: 'MU', address: '0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD', decimals: 18 },
  { symbol: 'ASML', address: '0x47F93d52cBeC7C6D2CfC080e154002370a60dAEA', decimals: 18 },
  { symbol: 'INTC', address: '0xc72b96e0E48ecd4DC75E1e45396e26300BC39681', decimals: 18 },
  { symbol: 'SNDK', address: '0xB90A19fF0Af67f7779afF50A882A9CfF42446400', decimals: 18 },
  { symbol: 'BABA', address: '0xad25Ac6C84D497db898fa1E8387bf6Af3532a1c4', decimals: 18 },
  { symbol: 'QQQ', address: '0xD5f3879160bc7c32ebb4dC785F8a4F505888de68', decimals: 18 },
  { symbol: 'GME', address: '0x1b0E319c6A659F002271B69dB8A7df2F911c153E', decimals: 18 },
  { symbol: 'SLV', address: '0x411eFb0E7f985935DAec3D4C3ebaEa0d0AD7D89f', decimals: 18 },
  { symbol: 'USO', address: '0xa30FA36Db767ad9eD3f7a60fC79526fB4d56D344', decimals: 18 },
];

/** A compact table (symbol and name, address, decimals) that fits a phone without sideways scrolling. */
export function ExitTokens() {
  return (
    <>
      <table className="knowledge-token-table">
        <colgroup><col className="knowledge-token-symbol" /><col /><col className="knowledge-token-decimals" /></colgroup>
        <thead><tr><th scope="col">{t('Token')}</th><th scope="col">{t('Address')}</th><th scope="col">{t('Decimals')}</th></tr></thead>
        <tbody>
          {EXIT_TOKENS.map((token) => {
            const name = token.symbol === 'USDG' ? t('Dollar stablecoin') : displayName(token.symbol);
            return (
              <tr key={token.symbol}>
                <td><b>{token.symbol}</b>{name ? <small>{name}</small> : null}</td>
                <td><Code>{token.address}</Code></td>
                <td>{token.decimals}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p>{t('For example, $5 of USDG is 5000000, and 0.5 of a stock token is 500000000000000000.')}</p>
    </>
  );
}

export const docsSections: Section[] = [
  { id: 'overview', eyebrow: '开发文档', title: '交接清晰的家庭金库合约', body: <><p>Sprout 是一个 Web 应用，用于为孩子种下一个金库合约、用准入的代币为它注资、安排定期投资、分享礼物链接，并在一个固定的链上时间戳把控制权移交给受益人。</p><p>浏览器端使用 React + Vite，通过 <Code>viem</Code> 进行钱包和合约调用。API 使用 Bun + Hono 和 <Code>bun:sqlite</Code>；它索引链上事件，并为控制台提供基于索引数据的 API 视图。</p></> },
  { id: 'flow', eyebrow: '功能概览', title: '系统中的完整路径', body: <><div className="knowledge-steps"><div><b>01</b><span>种下</span><small>工厂合约创建一个金库合约，设定受益人、结算代币、资产权重、交易场所和交接时间戳。</small></div><div><b>02</b><span>存入</span><small>支持的代币可以存入金库合约。真实的链上写入操作需要钱包签名。</small></div><div><b>03</b><span>成长</span><small>家长可以安排定期投资；礼物会增加资金，家务会在金库合约内预留奖励。</small></div><div><b>04</b><span>交接</span><small>到达不可更改的时间戳时，家长权限终止，受益人可以提取。</small></div></div></> },
  { id: 'contracts', eyebrow: '合约', title: '工厂、金库与交易场所的边界', body: <><p><Code>SproutFactory</Code> 准入已配置的资产和交易场所，并创建金库合约。<Code>SproutVault</Code> 存储家长、受益人、结算代币、配比权重、投资计划、里程碑、礼物和交接状态。</p><p>执行投资时，会调用一个已准入的交易场所，并附带根据报价计算出的最低输出数量。适配器和价格源都有前提条件：必须已配置交易场所，必须能获取报价，价格源必须可读且是最新的。价格过期或无效时，操作会直接失败，不会继续执行（fail closed）。</p></> },
  { id: 'exit', eyebrow: '不依赖应用', title: '直接调用小芽合约', body: <><p>Web 应用和服务器都不是必需的。每株小芽都是 <Code>SproutVault</Code> 的一个最小代理（minimal proxy）副本，已在 <a href={SOURCIFY_VAULT} target="_blank" rel="noopener noreferrer">Sourcify</a> 上验证，没有所有者、管理员密钥、暂停功能或升级途径。取出资金的全部途径就是下面这几个调用，任何合约工具都可以配合 <a href="/sprout-vault.abi.json">sprout-vault.abi.json</a> 发起它们：</p><ul><li><Code>createMilestone(bytes32 id, address token, uint256 amount, uint64 unlockTime)</Code> 和 <Code>releaseMilestone(bytes32 id)</Code>：仅限家长，且须在 <Code>graduationTimestamp</Code> 之前。代币必须是结算代币或在 <Code>assets()</Code> 之中，金额最多为余额减去 <Code>allowanceBucket</Code> 和 <Code>totalEarmarked</Code> 之后的数额。</li><li><Code>claimAllowance(address token, uint256 amount)</Code>：仅限受益人，任何时间均可调用，上限为 <Code>allowanceBucket(token)</Code>；款项支付给受益人。</li><li><Code>withdraw(address token, uint256 amount, address to)</Code>：仅限受益人，自 <Code>graduationTimestamp</Code> 起可调用；可支付到任意地址。</li></ul><p>除此之外，唯一会把代币转出的操作，是通过工厂合约准入的交易场所进行的买入，而买入所得仍留在金库合约中。代币地址和单位：</p><ExitTokens /><p><Code>bun run fork:exit</Code> 会在本地分叉链上，针对真实的工厂合约和每一株真实的小芽，完整运行这条路径，无需服务器。面向家庭的操作步骤见<a href="/guide#without-sprout">使用指南</a>。</p></> },
  { id: 'backend', eyebrow: '后端', title: '索引只是读模型，不是权威数据源', body: <><p>Bun 服务器在 SQLite 中存储小芽、礼物、礼物付款、里程碑、任务、链上事件、估值快照和 keeper 交易。索引器把链上状态核对同步到这个数据库，以便 API 能响应基于索引的控制台查询。</p><p>余额、角色、权限、配比、投资计划和交接都由合约强制执行。仅存于本设备的昵称和家务名称只是界面上的便利功能；应用会明确说明它们只保存在当前设备上。</p></> },
  { id: 'automation', eyebrow: '任务', title: '每周定投依赖可用的 keeper', body: <><p>周期计划会记录金额和周期。只有在配置了 keeper 签名者和完整的 gas 预算时，服务器才能运行到期的任务。自动化不可用时，界面会保持计划不变，并提示它无法运行。</p><p>Keeper 执行包含交易回执核对、按链和签名者加锁、nonce 跟踪以及手续费记账。已配置的任务并不能证明交易已经发生。</p></> },
  { id: 'references', eyebrow: '参考资料', title: '对照界面阅读源码', body: <><p>先阅读仓库的 README，然后查看 <Code>contracts/</Code>、<Code>server/src/indexer.ts</Code>、<Code>server/src/jobs.ts</Code>、<Code>shared/src/abis.ts</Code> 和 <Code>web/src/App.tsx</Code>。生成的 ABI 就是应用所使用的合约调用接口。</p><p>稳定的一手参考资料，请见 <a href="https://viem.sh/" target="_blank" rel="noreferrer">viem <ExternalLink size={13} /></a>、<a href="https://vite.dev/guide/" target="_blank" rel="noreferrer">Vite <ExternalLink size={13} /></a> 和 <a href="https://docs.soliditylang.org/" target="_blank" rel="noreferrer">Solidity <ExternalLink size={13} /></a>。</p></> },
];

export const whitepaperSections: Section[] = [
  { id: 'abstract', eyebrow: '技术草案 · v0.1 · 2026-09-14', title: 'Sprout：带有链上交接边界的家庭金库合约', body: <><p>Sprout 把一个由合约控制的金库合约，与一个小型的索引 Web 服务结合在一起。家长为受益人创建金库合约，选择准入的资产及其权重，为它注资，并可以安排定期投资。礼物和经批准的里程碑奖励使用同一个金库合约。到达固定的时间戳时，家长的控制权终止。</p><Callout tone="orange"><b>状态：</b>这是一份描述当前代码仓库设计的技术草案。它不是市场预测、产品认证，也不是关于投资回报的陈述。</Callout></> },
  { id: 'model', eyebrow: '系统模型', title: '一个金库合约，不同的参与方', body: <><p>家长是创建者，并在交接前拥有控制权。受益人在创建时指定，并在交接后获得控制权。送礼的亲友可以通过私密的礼物链接，向该链接绑定的金库合约付款；这个链接不授予提取权限。</p><p>合约是余额和权限的最终依据。API 验证由钱包发起的请求，核验交易回执，并提供索引记录和只读的链上快照。</p></> },
  { id: 'state', eyebrow: '状态转换', title: '种下、投资与交接', body: <><ul><li><b>种下：</b>工厂合约创建一个金库合约，带有不可更改的准入规则和交接时间戳。</li><li><b>存入：</b>在相应的钱包授权之后，准入的结算代币或股票代币转入金库合约。</li><li><b>计划：</b>家长记录一个周期性的投资计划；在已配置的情况下，keeper 可以执行到期的任务。</li><li><b>交接：</b>时间戳过后，家长操作停止，受益人可以提取。</li></ul><p>时间戳在种下时即已固定，最终的交接不可撤销。</p></> },
  { id: 'pricing', eyebrow: '执行约束', title: '报价、价格源与失败即拒绝（fail-closed）机制', body: <><p>每次投资之前，服务器会向已配置的交易场所请求报价，并据此推算最低输出数量。股票代币的估值读取已配置的价格源，并拒绝已暂停、无效、非正数或过期的报价轮次。如果某项持仓没有可信的价格，总额就是未知，而不会编造一个数值。</p><p>这种设计让前提条件清晰可见：已配置的交易场所、可读取的资产、最新的价格、可用的 RPC，以及有资金的 keeper，都是各自独立的依赖项。</p></> },
  { id: 'boundaries', eyebrow: '范围', title: '本设计并不确立的内容', body: <><p>本代码仓库并不确立任何费用、认证、审计、资产背书、法律上的可用性、保证收益或普遍的流动性。主网配置与本地演示配置的功能不同；缺少 keeper 密钥或 gas 预算时，自动投资可能处于停用状态。</p></> },
];

export const guideSections: Section[] = [
  { id: 'first-sprout', eyebrow: '从这里开始', title: '种下你的第一株小芽', body: <><ol><li>打开<a href="/dashboard">控制台</a>，连接钱包。</li><li>选择“种下小芽”，填写昵称和受益人钱包，选择资产配比，再选一个未来的交接日。</li><li>核对不可更改的交接信息，然后在钱包中签署这笔交易。</li></ol><p>昵称保存在这台设备上。受益人钱包就是在交接时获得控制权的那个地址。</p></> },
  { id: 'sample', eyebrow: '先看看', title: '先试试示例体验', body: <><p><a href="/test/">示例体验</a>会打开一个预先准备好的家庭钱包，里面是示例余额。它不使用任何钱包、小芽或实时数据，也不会签署交易。在连接钱包之前，可以先用控制台预览熟悉页面布局。</p></> },
  { id: 'weekly', eyebrow: '养成节奏', title: '设置每周定投', body: <><p>在一株真实的小芽中打开定投计划，选择结算金额和周期，然后签署设置计划的交易。计划要自动执行，必须先配置好 keeper（代为自动执行交易的服务）。当界面显示链已就绪时，你可以暂停或修改之后的投入。</p></> },
  { id: 'gifts', eyebrow: '亲友的心意', title: '分享礼物链接', body: <><p>在“礼物”中创建一个链接，并选择它接受哪些资产。把链接发给亲友；他们连接钱包、授权代币，然后向这个链接对应的小芽付款。礼物付款会增加资金，但永远不会给予提取权限。</p></> },
  { id: 'chores', eyebrow: '日常中的担当', title: '把家务变成奖励', body: <><p>家长创建一项家务，并设定一笔小芽里已有的代币作为奖励金额；这笔金额会从小芽余额中预留出来。到了解锁时间，家长把它发放到孩子（受益人）的零花钱额度中，孩子随后领取这笔零花钱。打开“家务与奖励”，可以查看已创建、已发放和已取消的里程碑。</p></> },
  { id: 'appearance', eyebrow: '按你的喜好', title: '设置外观', body: <><p>打开<a href="/settings">设置</a>，选择花园的外观，包括“跟随系统”。这个偏好保存在这台设备上，所以它跟随的是这个浏览器，不会改变其他任何人的界面。</p></> },
  { id: 'growing-up', eyebrow: '交接', title: '长大以后', body: <><p>交接日在种下小芽时就已固定。在此之前，由家长掌控。时间戳一过，家长的权限随即终止，孩子（受益人）可以接手，提取功能也随之解锁。交接无法撤销。</p><Callout>请妥善保管受益人钱包。Sprout 无法找回丢失的钱包，也无法撤销已完成的交接。</Callout></> },
  { id: 'without-sprout', eyebrow: '以防万一', title: '不通过 Sprout 取出资金', body: <><p>这个网站只是查看你的小芽的一扇窗。钱存放在小芽自己在 Robinhood Chain 上的合约里，所以即使 Sprout 有一天关闭了，钱也会原封不动地留在那里，免费工具依然可以访问它。Sprout 的任何人都无法转走、冻结或退还这笔钱。</p><Callout tone="orange"><b>趁网站还能用，现在就保存好这些：</b>你的小芽地址（在控制台顶部打开钱包菜单，复制“这株小芽”）、文件 <a href="/sprout-vault.abi.json">sprout-vault.abi.json</a>，以及这个页面。你还需要种下这株小芽的钱包和孩子的钱包，两个钱包里都要有少量 Robinhood Chain 上的 ETH，用来支付手续费。</Callout><ol><li>在装有你钱包的浏览器中打开 <a href="https://remix.ethereum.org" target="_blank" rel="noopener noreferrer">remix.ethereum.org</a>，并把钱包切换到 Robinhood Chain。</li><li>新建一个名为 <Code>SproutVault.abi</Code> 的文件，把 sprout-vault.abi.json 的内容粘贴进去，并保持这个文件处于打开状态。</li><li>打开 <b>Deploy &amp; run transactions</b>（部署和运行交易），在环境（Environment）中选择你的钱包（<b>Browser Extension</b> 或 <b>Injected Provider</b>），把你的小芽地址粘贴到合约地址框中，然后点击 <b>Add</b>（或 <b>At Address</b>）。小芽的各个按钮就会出现。</li><li><b>交接日之前，用种下这株小芽的钱包：</b>点击 <Code>createMilestone</Code>，填入一个没用过的 id（例如 <Code>0x0000000000000000000000000000000000000000000000000000000000000e01</Code>）、代币地址、金额，解锁时间填 <Code>0</Code>。然后用同一个 id 点击 <Code>releaseMilestone</Code>。把全部资金都这样发放出去，就是提前取出资金的办法。</li><li><b>用孩子的钱包：</b>点击 <Code>claimAllowance</Code>，填入代币地址和你发放的金额。这笔钱会到达孩子的钱包。</li><li><b>交接日当天或之后，用孩子的钱包：</b>点击 <Code>withdraw</Code>，填入代币地址、金额和接收资金的钱包地址。每种代币各操作一次。</li></ol><p>金额以每种代币的最小单位计：</p><ExitTokens /><p>这笔钱只能转到孩子的钱包，永远不会回到家长手里，所以这个钱包应该是你们家能打开的钱包。如果某一步现在还不被允许，工具会报错，什么也不会发送出去。建议先用一株金额很小的小芽练习一次，这样真正需要时你已经熟悉步骤。每株小芽运行的代码（包括同一份 ABI）会一直公开在 <a href={SOURCIFY_VAULT} target="_blank" rel="noopener noreferrer">Sourcify</a> 上，即使这个网站不在了也一样。</p></> },
  { id: 'tips', eyebrow: '小习惯', title: '使用 Sprout 的小贴士', body: <><ul><li>第一次签名之前，先试试示例预览。</li><li>在控制台查看支持的资产和当前的价格状态。</li><li>查看交易结果时，保持钱包连接。</li><li>把图表看作已有快照的记录，而不是对增长的承诺。</li><li>家里的预算或日程有变化时，暂停定投计划。</li></ul></> },
];

export const faqSections: Section[] = [
  { id: 'what', eyebrow: '基础知识', title: '什么是小芽？', body: <><p>小芽是为孩子准备的储蓄金库。它是 Robinhood Chain 上一个独立的智能合约，按你选择的配比，持有追踪苹果、特斯拉、SpaceX、英伟达等公司，以及标普 500 等基金的代币。新种下的小芽可以从 21 只股票中最多选 5 只；在股票名单扩充之前种下的小芽，只能在最初的四个选项中选择：苹果、英伟达、微软和标普 500。亲友可以通过礼物链接往里存钱；到了你选定的交接日，它就归孩子所有。</p></> },
  { id: 'custody', eyebrow: '安全', title: '钱由谁保管？', body: <><p>由小芽自己的合约保管。Sprout 网站从不托管资金，也无法转移资金：服务器只读取链上数据，用来显示余额和历史记录。对小芽的每一次改动，都是一笔在你钱包里签名的交易。</p><Callout tone="orange"><b>Sprout 目前是测试版。</b>合约尚未经过独立审计。主网交易使用真实资金且无法撤销，所以请只投入你能承受损失的钱。</Callout></> },
  { id: 'risks', eyebrow: '安全', title: '有哪些风险？', body: <><p><b>Sprout 目前还是测试版，涉及的是真实资金。</b>请只投入你能承受损失的钱。</p><RiskList /></> },
  { id: 'withdraw', eyebrow: '取出资金', title: '我可以提前取钱吗？', body: <><p>不可以。在交接日之前，任何人都不能从小芽中提取，包括种下它的家长。这正是它的意义所在：它更像一份信托，而不是一个活期账户。</p><p>资金提前流出的唯一途径是家务奖励：你预留一笔金额，在家务完成后批准发放，孩子再把它领取到自己的钱包。到了交接日，孩子的钱包可以提取全部资金。</p></> },
  { id: 'date', eyebrow: '取出资金', title: '交接日或孩子的钱包可以更改吗？', body: <><p>不可以。两者都在种下小芽时就已固定。签名之前，请再三核对孩子的钱包地址，并确保到了那一天，孩子能够使用这个钱包。Sprout 无法找回丢失的钱包。</p></> },
  { id: 'without-site', eyebrow: '取出资金', title: '如果网站打不开，我怎么取钱？', body: <><p>用 Remix 这类免费的合约工具，加上你的小芽地址就可以。交接日之前，由家长发放奖励，孩子把奖励领取到自己的钱包。从交接日起，孩子可以提取全部资金。<a href="/guide#without-sprout">家庭指南</a>里有具体步骤、代币地址和单位。请在需要之前，先保存一份指南和你的小芽地址。</p></> },
  { id: 'funding', eyebrow: '存入资金', title: '用什么存钱？', body: <><p>用 USDG，它是 Robinhood Chain 上的一种美元稳定币。在投资之前，小芽持有的就是这种代币。你也可以直接存入支持的股票代币。你需要一个连接到 Robinhood Chain 的钱包，并在这条链上准备少量 ETH 来支付网络手续费。</p></> },
  { id: 'buying', eyebrow: '投资', title: '钱是怎么变成股票的？', body: <><p>你存入的钱以 USDG 的形式到账，在小芽里等待投资。在控制台使用<b>立即买入</b>，用你自己的钱包按小芽的配比买入。每次买入都遵循小芽的股票配比，并会与市场价格源进行核对；如果交易池给出的价格比该价格差 1% 以上，买入就会被拒绝。</p><AutomationStatus /></> },
  { id: 'closed', eyebrow: '投资', title: '为什么价格显示“暂不可用”？', body: <><p>Sprout 只使用过去一天内更新过的股票价格。在周末和市场休市的节假日，价格源可能停止更新，因此 Sprout 会把相应的价值显示为“暂不可用”，并暂缓买入，直到价格更新，而不是去猜一个价格。如果“立即买入”是因为这个原因无法买入，它会告诉你。</p></> },
  { id: 'fees', eyebrow: '费用', title: '要花多少钱？', body: <><p>Sprout 的合约不收取任何费用。你签署的每笔交易都要支付网络手续费（以 Robinhood Chain 上的 ETH 支付）；买入时还要支付交易池的手续费，这部分已包含在你得到的价格中。</p></> },
  { id: 'gifts', eyebrow: '亲友', title: '礼物链接怎么用？', body: <><p>在“礼物”页面创建一个链接并分享出去。任何拿到链接的人都可以用自己的钱包往这株小芽里存钱。礼物一旦送出就无法收回，而且这个链接不会让任何人获得对小芽的任何控制权。</p></> },
  { id: 'site', eyebrow: '安全', title: '如果 Sprout 关闭了怎么办？', body: <><p>你的小芽会继续运作。它是 Robinhood Chain 上一个独立的合约，没有所有者，也没有管理员密钥，所以 Sprout 的任何人都无法转走、冻结或退还这笔钱，它的一切也都不依赖这个网站或我们的服务器。</p><p>交接日之前，钱只能以家长发放的奖励的形式流出，由孩子领取到自己的钱包。如果要提前全部取出，就把全部余额作为奖励发放。从交接日起，孩子的钱包可以把全部资金提取到任意地址。</p><p>没有这个网站时，可以用任何能调用合约的工具（例如 Remix），配合你的小芽地址来操作（在控制台顶部打开钱包菜单，复制“这株小芽”）。每株小芽运行的代码都已在 <a href="https://repo.sourcify.dev/4663/0x789ca950BAE92f4c18f5eBf776d54d85a0fF9A59" target="_blank" rel="noopener noreferrer">Sourcify</a> 上公开并通过验证。请记下这个地址，保管好孩子的钱包，具体步骤见<a href="/guide#without-sprout">不通过 Sprout 取出资金</a>。</p><Callout tone="orange">有些事情不在 Sprout 的掌控之内：股票代币和 USDG 依赖发行它们的公司，买入依赖交易池。如果交易池停止交易，提取和领取奖励仍然可以正常进行。</Callout></> },
  { id: 'privacy', eyebrow: '隐私', title: '你们会保存我家的哪些信息？', body: <><p>昵称和家务名称保存在你的浏览器里。服务器会保存钱包地址、小芽的合约地址、你给礼物链接起的标签，以及它索引的链上事件。除了礼物标签之外，这些信息本来就公开在链上。任何知道小芽合约地址的人都能看到它的余额，和链上的其他账户一样。</p></> },
  { id: 'eligibility', eyebrow: '开始之前', title: '我可以使用 Sprout 吗？', body: <><p>Robinhood 的股票代币并非在所有地区都可以获得。种下小芽之前，请先确认你所在的地区允许你持有这些代币。本网站的任何内容都不构成投资、税务或法律建议。</p></> },
];
