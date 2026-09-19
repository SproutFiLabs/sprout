import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  Copy,
  Leaf,
  LockKeyhole,
  MessageCircle,
  Plus,
  ShieldCheck,
  Sparkles,
  Wallet,
  X,
} from "lucide-react";
import {
  INTELLIGENCE_TOKEN,
  INTELLIGENCE_DISCLAIMER,
  type IntelligenceAccess,
  type IntelligenceConfigPublic,
  type IntelligenceMessage,
} from "@sprout/shared";
import { BloomGarden } from "../garden/BloomGarden";
import { ThemeToggle } from "../theme/ThemeSettings";
import {
  intelligenceChat,
  intelligenceConfig,
  intelligenceLogout,
  intelligenceWallet,
  verifyIntelligence,
  IntelligenceRequestError,
} from "./client";
import "./intelligence.css";

const TOPICS = [
  {
    title: "The bigger picture",
    label: "Understand the trade-offs",
    icon: "01",
    question:
      "What questions should we ask before putting money aside for our child?",
    intro: "Start with the purpose, then explore the options.",
    steps: [
      "What might the money be needed for—and when?",
      "How accessible does it need to be if family life changes?",
      "What are the costs, restrictions and risks to understand?",
    ],
  },
  {
    title: "Little money lessons",
    label: "Make learning a family habit",
    icon: "02",
    question: "How can I talk about money with a ten-year-old?",
    intro: "Begin with an everyday choice you can explore together.",
    steps: [
      "Compare two ways to spend a small, pretend budget.",
      "Ask what makes something a need, a want or a goal.",
      "Let them explain their thinking. The conversation matters more than a perfect answer.",
    ],
  },
  {
    title: "Before you decide",
    label: "Bring better questions",
    icon: "03",
    question:
      "Help me prepare questions for a financial adviser about our family’s goals.",
    intro: "A useful conversation makes the assumptions visible.",
    steps: [
      "Ask how the adviser is paid and what services are included.",
      "Discuss time horizons, access to money and the risks of each option.",
      "Ask what would change the approach, and how you would review it together.",
    ],
  },
];
type Verified = {
  token: string;
  expiresAt: number;
  access: IntelligenceAccess;
};
const short = (s: string) => `${s.slice(0, 6)}…${s.slice(-4)}`;
export function IntelligencePage() {
  const [config, setConfig] = useState<IntelligenceConfigPublic | null>(null);
  const [verified, setVerified] = useState<Verified | null>(null);
  const [connecting, setConnecting] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [topic, setTopic] = useState(0),
    [draft, setDraft] = useState(""),
    [messages, setMessages] = useState<IntelligenceMessage[]>([]),
    [copied, setCopied] = useState(false);
  const epoch = useRef(0),
    request = useRef<AbortController | null>(null),
    session = useRef<Verified | null>(null),
    cleanupProvider = useRef<(() => void) | null>(null);
  const input = useRef<HTMLTextAreaElement>(null),
    conversationEnd = useRef<HTMLDivElement>(null);
  const example = TOPICS[topic]!;
  const reset = useCallback(() => {
    epoch.current++;
    request.current?.abort();
    cleanupProvider.current?.();
    cleanupProvider.current = null;
    const previous = session.current;
    session.current = null;
    if (previous) void intelligenceLogout(previous.token).catch(() => {});
    setVerified(null);
    setMessages([]);
    setDraft("");
    setConnecting(false);
    setBusy(false);
  }, []);
  useEffect(() => {
    const previousTitle = document.title;
    document.title =
      "SPROUT Intelligence — A little clarity. A growing tomorrow.";
    let active = true;
    intelligenceConfig()
      .then((c) => {
        if (active) setConfig(c);
      })
      .catch(() => {
        if (active)
          setError(
            "Could not check availability. Refresh the page to try again.",
          );
      });
    return () => {
      document.title = previousTitle;
      active = false;
      epoch.current++;
      request.current?.abort();
      cleanupProvider.current?.();
    };
  }, []);
  useEffect(() => {
    if (!verified) return;
    const timer = setTimeout(
      () => {
        reset();
        setError("Your session has ended. Verify your wallet to continue.");
      },
      Math.max(0, verified.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [verified, reset]);
  useEffect(() => {
    if (error)
      document
        .querySelector(".si-error")
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [error]);
  useEffect(() => {
    if (messages.length)
      conversationEnd.current?.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
  }, [messages.length, busy]);
  async function connect() {
    if (connecting) return;
    if (!config) {
      setError("Still checking availability. Please try again in a moment.");
      return;
    }
    setConnecting(true);
    setError("");
    const version = ++epoch.current;
    try {
      const next = await intelligenceWallet(config);
      if (version !== epoch.current) return;
      const changed = () => {
        reset();
        setError("Your wallet changed. Verify it again to continue.");
      };
      next.provider.on?.("accountsChanged", changed);
      next.provider.on?.("chainChanged", changed);
      next.provider.on?.("disconnect", changed);
      cleanupProvider.current = () => {
        next.provider.removeListener?.("accountsChanged", changed);
        next.provider.removeListener?.("chainChanged", changed);
        next.provider.removeListener?.("disconnect", changed);
      };
      const result = await verifyIntelligence(next);
      if (version !== epoch.current) {
        void intelligenceLogout(result.token).catch(() => {});
        return;
      }
      session.current = result;
      setVerified(result);
      setMessages([]);
    } catch (e) {
      if (version === epoch.current) {
        cleanupProvider.current?.();
        cleanupProvider.current = null;
        setError(
          e instanceof Error ? e.message : "Wallet verification was cancelled.",
        );
      }
    } finally {
      if (version === epoch.current) setConnecting(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim() || busy) return;
    if (!verified) {
      void connect();
      return;
    }
    if (!config?.aiReady) {
      setError("Live AI is being connected. Please try again later.");
      return;
    }
    if (messages.length >= 10) {
      setError(
        "This conversation is complete. Start a new one to explore another question.",
      );
      return;
    }
    const content = draft.trim(),
      next: IntelligenceMessage[] = [...messages, { role: "user", content }];
    const version = epoch.current;
    setMessages(next);
    setDraft("");
    setBusy(true);
    setError("");
    const controller = new AbortController();
    request.current = controller;
    try {
      const result = await intelligenceChat(
        next,
        verified.token,
        controller.signal,
      );
      if (version !== epoch.current) return;
      setMessages([...next, { role: "assistant", content: result.answer }]);
    } catch (e) {
      if (version !== epoch.current) return;
      if (
        e instanceof IntelligenceRequestError &&
        [401, 403].includes(e.status)
      )
        reset();
      else {
        setMessages(messages);
        setDraft(content);
      }
      setError(
        e instanceof Error
          ? e.message
          : "We could not finish that answer. Please try again.",
      );
    } finally {
      if (version === epoch.current) setBusy(false);
    }
  }
  function choose(index: number) {
    setTopic(index);
    setDraft(TOPICS[index]!.question);
    setError("");
    input.current?.focus({ preventScroll: true });
  }
  function newConversation() {
    if (busy) return;
    setMessages([]);
    setDraft("");
    setError("");
    input.current?.focus({ preventScroll: true });
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(INTELLIGENCE_TOKEN);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError(
        "Copy is unavailable in this browser. You can select the contract address below.",
      );
    }
  }
  return (
    <main className="si-page">
      <header className="si-header si-wrap">
        <a className="si-brand" href="/" aria-label="SPROUT home">
          <img src="/brand/sprout-logo.png" alt="" />
          SPROUT<span>Intelligence</span>
        </a>
        <nav aria-label="Intelligence navigation">
          <a href="#how-it-helps">How it helps</a>
          <a href="/dashboard">
            Your garden <ArrowUpRight size={14} />
          </a>
          <ThemeToggle />
          <button
            className="si-button si-button--small"
            disabled={connecting || !config}
            onClick={
              verified
                ? () => {
                    reset();
                    setError("");
                  }
                : connect
            }
          >
            <Wallet size={15} />
            {connecting
              ? "Verifying…"
              : verified
                ? "Disconnect"
                : "Connect wallet"}
          </button>
        </nav>
      </header>
      <section className="si-hero si-wrap">
        <div className="si-hero-copy">
          <div className="si-eyebrow">
            <span /> A LITTLE GUIDANCE. A LOT OF POSSIBILITY.
          </div>
          <h1>
            A little clarity.
            <br />
            For their <em>big future.</em>
          </h1>
          <p>
            Meet SPROUT Intelligence. A thoughtful AI companion that helps
            parents understand the options, ask better questions and make more
            informed decisions.
          </p>
          <div className="si-hero-actions">
            <a className="si-button" href="#intelligence">
              Explore Intelligence <ArrowDown size={16} />
            </a>
            <span>
              <ShieldCheck size={16} /> Not financial advice
            </span>
          </div>
        </div>
        <div className="si-hero-art" aria-hidden="true">
          <span className="si-orbit si-orbit--one" />
          <span className="si-orbit si-orbit--two" />
          <span className="si-orbit si-orbit--three" />
          <div className="si-botanical">
            <BloomGarden compact fullyBloomed scrollMarker={false} />
          </div>
          <div className="si-art-note">
            <Sparkles size={15} />
            <span>Room for better questions.</span>
          </div>
          <span className="si-art-caption">
            A GROWING MIND, FOR A GROWING FAMILY.
          </span>
        </div>
      </section>
      <section className="si-holder si-wrap" aria-label="Holder access">
        <div className="si-holder-label">
          <span className="si-holder-icon">
            <Leaf />
          </span>
          <div>
            <small>A LITTLE THANK YOU TO OUR HOLDERS</small>
            <h2>Your SPROUT. Your access.</h2>
          </div>
        </div>
        <div className="si-threshold">
          <strong>
            1,000,000<span> SPROUT</span>
          </strong>
          <p>Hold at least 1 million tokens. Intelligence is free to use.</p>
        </div>
        <a href="#access-details" className="si-holder-link">
          How access works <ArrowUpRight size={17} />
        </a>
      </section>
      <section
        className="si-workspace si-wrap"
        id="intelligence"
        aria-label="SPROUT Intelligence workspace"
      >
        <div className="si-section-label">
          <span>
            <Sparkles size={17} /> YOUR SPACE TO THINK THINGS THROUGH
          </span>
          <span className="si-mode">
            <i />
            {verified ? "Holder verified" : "Explore an example"}
          </span>
        </div>
        <div className="si-studio">
          <aside className="si-sidebar">
            <div className="si-sidebar-title">
              <span className="si-leaf-mark">
                <Leaf size={22} />
              </span>
              <strong>
                Intelligence<small>Made for the parent in you.</small>
              </strong>
            </div>
            <button
              className="si-new"
              onClick={newConversation}
              disabled={busy}
            >
              <Plus size={17} /> A fresh conversation
            </button>
            <span className="si-sidebar-caption">A GOOD PLACE TO START</span>
            <div className="si-topics">
              {TOPICS.map((item, i) => (
                <button
                  key={item.title}
                  onClick={() => choose(i)}
                  disabled={busy}
                  className={topic === i ? "is-selected" : ""}
                  aria-pressed={topic === i}
                >
                  <span>{item.icon}</span>
                  <div>
                    {item.title}
                    <small>{item.label}</small>
                  </div>
                  <ArrowUpRight size={15} />
                </button>
              ))}
            </div>
            <div className="si-sidebar-bottom">
              <ShieldCheck size={20} />
              <strong>You stay in the driver’s seat.</strong>
              <p>Explore ideas and questions. Every decision remains yours.</p>
              <a href="#access-details">
                About access & privacy <ArrowUpRight size={13} />
              </a>
            </div>
          </aside>
          <div className="si-chat">
            <header className="si-chat-header">
              <div>
                <span className="si-chat-dot" />
                SPROUT Intelligence <span className="si-ai-badge">AI</span>
              </div>
              <small>
                {verified
                  ? short(verified.access.address)
                  : "For curious parents"}
              </small>
            </header>
            <div
              className="si-conversation"
              role="log"
              aria-label="Conversation"
              aria-live="polite"
              aria-busy={busy}
            >
              {!messages.length ? (
                <>
                  <div className="si-conversation-heading">
                    <span className="si-eyebrow">
                      {verified
                        ? "A FRESH PERSPECTIVE"
                        : "EXAMPLE CONVERSATION · NOT A LIVE AI ANSWER"}
                    </span>
                    <h2>
                      Big questions.
                      <br />
                      <em>Let’s make a little sense of them.</em>
                    </h2>
                  </div>
                  {!verified ? (
                    <>
                      <div className="si-question">
                        <span>You might ask</span>
                        <p>{example.question}</p>
                      </div>
                      <div className="si-answer-example">
                        <span className="si-answer-symbol">
                          <Leaf size={19} />
                        </span>
                        <div>
                          <strong>{example.intro}</strong>
                          <ol>
                            {example.steps.map((step) => (
                              <li key={step}>{step}</li>
                            ))}
                          </ol>
                          <a
                            href="https://www.consumerfinance.gov/consumer-tools/money-as-you-grow/"
                            target="_blank"
                            rel="noreferrer"
                          >
                            Parent learning resource · CFPB{" "}
                            <ArrowUpRight size={12} />
                          </a>
                        </div>
                      </div>
                    </>
                  ) : (
                    <p className="si-welcome">
                      What’s on your mind? Ask about a money concept, compare
                      general trade-offs or plan a conversation with your child.
                      Please leave out names, account details and other
                      sensitive information.
                    </p>
                  )}
                </>
              ) : (
                messages.map((message, i) => (
                  <article
                    className={`si-message si-message--${message.role}`}
                    key={i}
                  >
                    <span>
                      {message.role === "user" ? "You" : "SPROUT Intelligence"}
                    </span>
                    <div>{message.content}</div>
                  </article>
                ))
              )}
              {busy && (
                <div className="si-thinking">
                  <span />
                  <span />
                  <span />
                  Thinking it through…
                </div>
              )}
              <div ref={conversationEnd} />
            </div>
            <div className="si-composer-wrap">
              {error && (
                <div className="si-error" role="alert">
                  <span>{error}</span>
                  <button
                    aria-label="Dismiss message"
                    onClick={() => setError("")}
                  >
                    <X size={16} />
                  </button>
                </div>
              )}
              {!verified && (
                <div className="si-unlock">
                  <LockKeyhole size={15} />
                  <span>
                    Live answers are free for verified 1M+ SPROUT holders.
                  </span>
                  <button onClick={connect} disabled={connecting || !config}>
                    {connecting ? "Verifying…" : "Unlock access"}{" "}
                    <ArrowRight size={14} />
                  </button>
                </div>
              )}
              {config && (!config.verificationReady || !config.aiReady) && (
                <p className="si-availability" role="status">
                  Live access is being connected. You can explore the examples
                  now.
                </p>
              )}
              <form onSubmit={submit} className="si-composer">
                <label htmlFor="si-question" className="si-sr-only">
                  Your question for SPROUT Intelligence
                </label>
                <textarea
                  id="si-question"
                  ref={input}
                  value={draft}
                  maxLength={2500}
                  rows={2}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="A question today. A clearer tomorrow."
                  disabled={busy}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing
                    ) {
                      e.preventDefault();
                      e.currentTarget.form?.requestSubmit();
                    }
                  }}
                />
                <button
                  className="si-send"
                  type="submit"
                  disabled={busy || connecting || !draft.trim() || !config}
                  aria-label={
                    verified ? "Send question" : "Verify wallet to ask"
                  }
                >
                  <ArrowRight size={21} />
                </button>
              </form>
              <p className="si-disclaimer">
                AI can make mistakes. {INTELLIGENCE_DISCLAIMER}
              </p>
            </div>
          </div>
        </div>
      </section>
      <section className="si-help si-wrap" id="how-it-helps">
        <div className="si-section-intro">
          <span className="si-eyebrow">THOUGHTFUL SUPPORT, AT YOUR PACE</span>
          <h2>
            A clearer head.
            <br />A more confident conversation.
          </h2>
          <p>
            You don’t need to know all the answers. A few good questions are a
            lovely place to start.
          </p>
        </div>
        <div className="si-help-grid">
          {[
            {
              icon: <Leaf />,
              title: "Understand, a little better.",
              text: "Untangle unfamiliar terms and explore the risks, costs and questions behind the options.",
              color: "mint",
            },
            {
              icon: <MessageCircle />,
              title: "Learn, a little together.",
              text: "Find everyday ways to talk about needs, wants, goals and money habits with your child.",
              color: "orange",
            },
            {
              icon: <Sparkles />,
              title: "Decide, with more context.",
              text: "Organize your thinking and prepare better questions for a qualified professional.",
              color: "purple",
            },
          ].map((card) => (
            <article
              className={`si-help-card si-help-card--${card.color}`}
              key={card.title}
            >
              <span>{card.icon}</span>
              <h3>{card.title}</h3>
              <p>{card.text}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="si-access si-wrap" id="access-details">
        <div>
          <span className="si-eyebrow">A SIMPLE WAY IN</span>
          <h2>
            Hold a million.
            <br />
            <em>Open a little perspective.</em>
          </h2>
          <p>
            Free access while your verified wallet holds at least 1,000,000
            SPROUT. Your tokens stay yours.
          </p>
          <button
            className="si-button"
            onClick={
              verified
                ? () =>
                    document
                      .getElementById("intelligence")
                      ?.scrollIntoView({ behavior: "smooth" })
                : connect
            }
            disabled={connecting || !config}
          >
            {verified ? <CheckCheck size={16} /> : <Wallet size={16} />}{" "}
            {verified
              ? "Return to Intelligence"
              : connecting
                ? "Verifying…"
                : "Check my access"}{" "}
            <ArrowRight size={16} />
          </button>
          <div className="si-contract">
            <small>SPROUT TOKEN · ROBINHOOD CHAIN</small>
            <code>{INTELLIGENCE_TOKEN}</code>
            <button onClick={copy} aria-label="Copy SPROUT contract address">
              {copied ? <Check size={15} /> : <Copy size={15} />}{" "}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
        <div className="si-access-steps">
          <article>
            <span>01</span>
            <div>
              <h3>Connect your wallet.</h3>
              <p>
                Sign a verification message to show it’s yours. No transaction
                or spending approval.
              </p>
            </div>
          </article>
          <article>
            <span>02</span>
            <div>
              <h3>We check your SPROUT.</h3>
              <p>
                The balance is checked on the token’s network, then checked
                again with every question.
              </p>
            </div>
          </article>
          <article>
            <span>03</span>
            <div>
              <h3>Bring your questions.</h3>
              <p>
                Explore at your own pace. {config?.dailyLimit ?? 40} questions
                per wallet per day, subject to service capacity.
              </p>
            </div>
          </article>
        </div>
      </section>
      <section
        className="si-faq si-wrap"
        aria-label="Questions about Intelligence"
      >
        <h2>A few things worth knowing.</h2>
        <details>
          <summary>Is this financial advice?</summary>
          <p>
            No. SPROUT Intelligence provides general education and information.
            It does not recommend specific investments, promise returns or make
            decisions for you. Speak with a qualified professional for advice
            about your circumstances.
          </p>
        </details>
        <details>
          <summary>Do I have to stake or spend my tokens?</summary>
          <p>
            No. Access checks your wallet’s balance. You never need to transfer
            tokens, approve spending or pay a subscription to use holder access.
            Holding SPROUT involves market risk; access is not a recommendation
            to buy it.
          </p>
        </details>
        <details>
          <summary>What happens to my questions?</summary>
          <p>
            Chats stay in this page’s memory and disappear when you refresh,
            disconnect or start a fresh conversation. For live answers, your
            messages are sent to our server and the AI provider (OpenAI). SPROUT
            does not save chat transcripts; the provider’s own data policies
            still apply. Avoid personal details about your child, account
            information and wallet secrets.
          </p>
        </details>
        <details>
          <summary>What if my balance changes?</summary>
          <p>
            Access requires at least 1,000,000 SPROUT at verification and before
            each answer. If the balance falls below the threshold, or cannot be
            checked, live answers stay locked. You can verify again later.
          </p>
        </details>
      </section>
      <footer className="si-footer si-wrap">
        <a className="si-brand" href="/">
          <img src="/brand/sprout-logo.png" alt="" />
          SPROUT
        </a>
        <p>A little understanding. A growing tomorrow.</p>
        <span>Intelligence · {INTELLIGENCE_DISCLAIMER}</span>
      </footer>
    </main>
  );
}
