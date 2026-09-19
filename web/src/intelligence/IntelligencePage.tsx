import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Copy,
  Plus,
  Wallet,
  X,
  ArrowUp,
  ChevronLeft,
} from "lucide-react";
import {
  INTELLIGENCE_TOKEN,
  INTELLIGENCE_DISCLAIMER,
  type IntelligenceAccess,
  type IntelligenceConfigPublic,
  type IntelligenceMessage,
} from "@sprout/shared";
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
    title: "Planning for a child",
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
    title: "Teaching kids about money",
    question: "How can I talk about money with a ten-year-old?",
    intro: "Begin with an everyday choice you can explore together.",
    steps: [
      "Compare two ways to spend a small, pretend budget.",
      "Ask what makes something a need, a want or a goal.",
      "Let them explain their thinking. The conversation matters more than a perfect answer.",
    ],
  },
  {
    title: "Preparing for an adviser",
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
  const [showExample, setShowExample] = useState(false);
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
    setShowExample(false);
    setMessages([]);
    setDraft("");
    setConnecting(false);
    setBusy(false);
  }, []);
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "SPROUT Intelligence | Family money, explained";
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
      document.querySelector(".si-error")?.scrollIntoView({
        block: "center",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
  }, [error]);
  useEffect(() => {
    if (messages.length)
      conversationEnd.current?.scrollIntoView({
        block: "nearest",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
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
      setShowExample(false);
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
      setError(
        "Live answers are not available yet. You can browse the examples.",
      );
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
  function focusQuestion() {
    requestAnimationFrame(() => {
      input.current?.focus({ preventScroll: true });
      input.current?.scrollIntoView({
        block: "center",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
    });
  }
  function choose(index: number) {
    setTopic(index);
    setShowExample(false);
    setDraft(TOPICS[index]!.question);
    setError("");
    focusQuestion();
  }
  function newConversation() {
    if (busy) return;
    setMessages([]);
    setShowExample(false);
    setDraft("");
    setError("");
    focusQuestion();
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
  const ready = Boolean(config?.aiReady && config?.verificationReady);
  const promptPlaceholder =
    "For example: How do I explain saving to my ten-year-old?";
  return (
    <main className="si-page">
      <a className="si-skip" href="#intelligence">
        Skip to Intelligence
      </a>
      <header className="si-header si-wrap">
        <a className="si-brand" href="/" aria-label="SPROUT home">
          <img src="/brand/sprout-logo.png" alt="" />
          SPROUT
        </a>
        <nav aria-label="Main navigation">
          <a href="/dashboard">Your garden</a>
          <a href="/intelligence" aria-current="page">
            Intelligence
          </a>
        </nav>
        <div className="si-header-actions">
          <ThemeToggle />
          <button
            className="si-wallet"
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
            <Wallet size={16} />
            <span>
              {connecting
                ? "Verifying…"
                : verified
                  ? "Disconnect"
                  : "Connect wallet"}
            </span>
          </button>
        </div>
      </header>
      <div className="si-layout si-wrap">
        <section
          className="si-workspace"
          id="intelligence"
          tabIndex={-1}
          aria-label="SPROUT Intelligence workspace"
        >
          <div className="si-workspace-top">
            <p>
              SPROUT Intelligence{" "}
              <span>{ready ? "For parents" : "Preview"}</span>
            </p>
            <button
              className="si-new"
              onClick={newConversation}
              disabled={busy}
            >
              <Plus size={16} />
              New conversation
            </button>
          </div>
          <div className="si-intro">
            <h1>
              What would you like
              <br />
              to understand?
            </h1>
            <p>
              A space for your family’s money questions. Explore the options,
              learn the basics and prepare for your next decision.
            </p>
          </div>
          <div className="si-mode-switch" aria-label="Conversation view">
            <button
              aria-pressed={!showExample}
              onClick={() => setShowExample(false)}
            >
              Your question
            </button>
            <button
              aria-pressed={showExample}
              onClick={() => setShowExample(true)}
              disabled={busy}
            >
              See an example <ArrowUpRight size={13} />
            </button>
            <span>Not financial advice</span>
          </div>
          {showExample ? (
            <article className="si-example" aria-label="Authored example">
              <div className="si-example-top">
                <span>Written example · Not generated live</span>
                <span>{String(topic + 1).padStart(2, "0")} / 03</span>
              </div>
              <h2>{example.question}</h2>
              <p className="si-example-intro">{example.intro}</p>
              <ol>
                {example.steps.map((step, i) => (
                  <li key={step}>
                    <span>{i + 1}</span>
                    <p>{step}</p>
                  </li>
                ))}
              </ol>
              <div className="si-example-bottom">
                <a
                  href="https://www.consumerfinance.gov/consumer-tools/money-as-you-grow/"
                  target="_blank"
                  rel="noreferrer"
                >
                  Further reading: CFPB <ArrowUpRight size={13} />
                </a>
                <button
                  onClick={() => {
                    setDraft(example.question);
                    setShowExample(false);
                    focusQuestion();
                  }}
                >
                  Use this question <ArrowRight size={15} />
                </button>
              </div>
            </article>
          ) : (
            <>
              {messages.length > 0 && (
                <div
                  className="si-conversation"
                  role="log"
                  aria-live="polite"
                  aria-busy={busy}
                  aria-label="Conversation"
                >
                  {messages.map((message, i) => (
                    <article
                      className={`si-message si-message--${message.role}`}
                      key={i}
                    >
                      <span>
                        {message.role === "user"
                          ? "You"
                          : "SPROUT Intelligence"}
                      </span>
                      <div>{message.content}</div>
                    </article>
                  ))}
                  {busy && (
                    <p className="si-thinking">
                      Preparing your answer<span>…</span>
                    </p>
                  )}
                  <div ref={conversationEnd} />
                </div>
              )}
              <form onSubmit={submit} className="si-composer">
                <label htmlFor="si-question">Your question</label>
                <textarea
                  id="si-question"
                  ref={input}
                  value={draft}
                  maxLength={2500}
                  rows={3}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={promptPlaceholder}
                  disabled={busy}
                  aria-describedby="si-privacy-hint"
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
                <div className="si-composer-bottom">
                  <span>
                    {verified ? (
                      <>
                        <Check size={13} />
                        Wallet verified · {short(verified.access.address)}
                      </>
                    ) : (
                      <>Free for 1M+ SPROUT holders</>
                    )}
                  </span>
                  <button
                    className="si-send"
                    type="submit"
                    disabled={busy || connecting || !draft.trim() || !config}
                    aria-label={
                      verified ? "Send question" : "Verify wallet to ask"
                    }
                  >
                    {busy
                      ? "Thinking"
                      : connecting
                        ? "Verifying"
                        : verified
                          ? "Send question"
                          : "Connect to ask"}
                    {verified ? (
                      <ArrowUp size={17} />
                    ) : (
                      <ArrowRight size={17} />
                    )}
                  </button>
                </div>
              </form>
              <div className="si-composer-note">
                <p id="si-privacy-hint">
                  Leave out names, account details and wallet secrets.
                </p>
                <span>{draft.length.toLocaleString()} / 2,500</span>
              </div>
            </>
          )}
          {error && (
            <div className="si-error" role="alert">
              <p>{error}</p>
              <button aria-label="Dismiss message" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {!config && !error && (
            <p className="si-availability" role="status">
              Checking availability…
            </p>
          )}
          {config && !ready && (
            <p className="si-availability" role="status">
              <span />
              Live answers are not available yet. Explore a written example
              above.
            </p>
          )}
          <section className="si-topics" aria-label="Suggested questions">
            <div className="si-section-heading">
              <h2>
                {showExample ? "More examples" : "Not sure where to start?"}
              </h2>
              <span>Choose a topic</span>
            </div>
            {TOPICS.map((item, i) => (
              <button
                key={item.title}
                onClick={() => {
                  if (showExample) {
                    setTopic(i);
                    requestAnimationFrame(() =>
                      document.querySelector(".si-example")?.scrollIntoView({
                        block: "start",
                        behavior: window.matchMedia(
                          "(prefers-reduced-motion: reduce)",
                        ).matches
                          ? "auto"
                          : "smooth",
                      }),
                    );
                  } else choose(i);
                }}
                disabled={busy}
                className={showExample && topic === i ? "is-selected" : ""}
              >
                <span className="si-topic-number">0{i + 1}</span>
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.question}</span>
                </div>
                <ArrowRight size={18} />
              </button>
            ))}
          </section>
          <p className="si-disclaimer">
            AI can make mistakes. {INTELLIGENCE_DISCLAIMER}
          </p>
        </section>
        <aside
          className="si-access"
          id="access-details"
          aria-label="Holder access and privacy"
        >
          <div className="si-access-heading">
            <span>Included for holders</span>
            <a
              href="#access-explained"
              aria-label="Read how holder access works"
            >
              <ArrowUpRight size={17} />
            </a>
          </div>
          <div className="si-access-amount">
            <strong>1,000,000</strong>
            <span>SPROUT</span>
          </div>
          <p className="si-access-description">
            Hold at least 1 million SPROUT on Robinhood Chain for free access.
          </p>
          <div className="si-access-state">
            <span className={verified ? "is-verified" : ""} />
            {verified ? "Your wallet qualifies" : "Wallet not connected"}
          </div>
          <div className="si-access-detail" id="access-explained">
            <h2>How access works</h2>
            <ol>
              <li>
                <span>01</span>
                <p>
                  Connect your wallet and sign a message to verify ownership.
                </p>
              </li>
              <li>
                <span>02</span>
                <p>
                  We check your SPROUT balance before each answer. Your tokens
                  stay in your wallet.
                </p>
              </li>
            </ol>
            <p className="si-allowance">
              {config?.dailyLimit ?? 40} questions per wallet each day, subject
              to service capacity.
            </p>
          </div>
          <div className="si-art" aria-hidden="true">
            <img src="/art/dashboard/hero-bouquet.png" alt="" />
          </div>
          <div className="si-contract">
            <span>Token contract · Robinhood Chain</span>
            <div>
              <code>{INTELLIGENCE_TOKEN}</code>
              <button onClick={copy} aria-label="Copy SPROUT contract address">
                {copied ? <Check size={15} /> : <Copy size={15} />}
              </button>
            </div>
            <span className="si-copy-status" role="status">
              {copied ? "Contract address copied" : ""}
            </span>
          </div>
          <p className="si-token-note">
            Token ownership carries market risk. Access is not a recommendation
            to buy SPROUT.
          </p>
          <a className="si-privacy-link" href="#privacy">
            About your conversation <ArrowRight size={14} />
          </a>
        </aside>
      </div>
      <section
        className="si-information si-wrap"
        id="privacy"
        aria-label="About your conversation"
      >
        <div>
          <span>Before you ask</span>
          <h2>
            About
            <br />
            Intelligence.
          </h2>
        </div>
        <div className="si-information-copy">
          <article>
            <h3>Education, not investment advice.</h3>
            <p>
              Intelligence explains concepts and helps you prepare questions. It
              is not a financial adviser and cannot make decisions for your
              family. For advice about your circumstances, speak with a
              qualified professional.
            </p>
          </article>
          <article>
            <h3>Your conversation is temporary.</h3>
            <p>
              SPROUT does not save chat transcripts. Live questions go to our
              server and OpenAI, whose data policies apply. Refreshing,
              disconnecting or starting a new conversation clears this page’s
              chat.
            </p>
          </article>
        </div>
      </section>
      <footer className="si-footer si-wrap">
        <a href="/">
          <ChevronLeft size={14} />
          Back to SPROUT
        </a>
        <span>Family money, explained.</span>
        <a href="/dashboard">
          Open your garden <ArrowUpRight size={14} />
        </a>
      </footer>
    </main>
  );
}
