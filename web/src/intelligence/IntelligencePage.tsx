import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
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
  MessageCircle,
  BookOpen,
  Info,
  LockKeyhole,
} from "lucide-react";
import {
  FAMILY_SOURCES,
  INTELLIGENCE_TOKEN,
  INTELLIGENCE_DISCLAIMER,
  type IntelligenceAccess,
  type IntelligenceConfigPublic,
  type IntelligenceMessage,
} from "@sprout/shared";
import { ThemeToggle } from "../theme/ThemeSettings";
import { t, tj, useLocale } from "../i18n";
import { LanguageToggle } from "../i18n/LanguageToggle";
import { AnswerText } from "./AnswerText";
import { prefillQuestion } from "./prefill";
import {
  intelligenceChat,
  intelligenceConfig,
  intelligenceLogout,
  intelligenceWallet,
  verifyIntelligence,
  IntelligenceRequestError,
} from "./client";
import "./intelligence.css";
import "./intelligence-language.css";

// Kept in English: t() translates each field where it is shown.
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
// The page styles give every .theme-toggle `margin-left: auto`; this keeps the
// appearance and language switches side by side at the end of their row.
const TOGGLES: CSSProperties = {
  marginLeft: "auto",
  display: "flex",
  alignItems: "center",
};
export function IntelligencePage() {
  const locale = useLocale();
  const contextParams = new URLSearchParams(window.location.search);
  const contextKind = contextParams.get("context");
  const selectedContext = ["asset","ledger","reward"].includes(contextKind??"") && contextParams.get("id") ? {kind:contextKind as "asset"|"ledger"|"reward",id:contextParams.get("id")!.slice(0,100)} : undefined;
  const [config, setConfig] = useState<IntelligenceConfigPublic | null>(null);
  const [verified, setVerified] = useState<Verified | null>(null);
  const [connecting, setConnecting] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [topic, setTopic] = useState(0),
    [draft, setDraft] = useState(prefillQuestion),
    [messages, setMessages] = useState<IntelligenceMessage[]>([]),
    [copied, setCopied] = useState(false);
  const [showExample, setShowExample] = useState(false);
  const details = useRef<HTMLDialogElement>(null);
  const scrollArea = useRef<HTMLDivElement>(null);
  const epoch = useRef(0),
    request = useRef<AbortController | null>(null),
    session = useRef<Verified | null>(null),
    cleanupProvider = useRef<(() => void) | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
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
    document.title = t("SPROUT Intelligence | Family money, explained");
  }, [locale]);
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
    const field = input.current;
    if (field) {
      field.style.height = "auto";
      field.style.height = `${Math.min(field.scrollHeight, 160)}px`;
    }
  }, [draft, showExample]);
  useEffect(() => {
    const area = scrollArea.current;
    if (!area) return;
    if (showExample || !messages.length) {
      area.scrollTo({ top: 0, behavior: "instant" });
      return;
    }
    const last = area.querySelector<HTMLElement>(".si-message:last-of-type");
    const top = busy
      ? area.scrollHeight
      : last
        ? area.scrollTop +
          last.getBoundingClientRect().top -
          area.getBoundingClientRect().top -
          24
        : 0;
    area.scrollTo({
      top,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }, [messages.length, busy, showExample]);
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
        selectedContext,
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
    requestAnimationFrame(() => input.current?.focus({ preventScroll: true }));
  }
  function choose(index: number) {
    setTopic(index);
    setShowExample(false);
    // Send the question as shown, so a Chinese visitor gets a Chinese answer.
    setDraft(t(TOPICS[index]!.question));
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
  const inConversation = messages.length > 0;
  return (
    <main className="si-page">
      <a className="si-skip" href="#intelligence">
        {t("Skip to your question")}
      </a>
      <aside className="si-sidebar" aria-label={t("Intelligence navigation")}>
        <a className="si-brand" href="/" aria-label={t("SPROUT home")}>
          <SproutMark />
          SPROUT<span>Intelligence</span>
        </a>
        <button className="si-new" onClick={newConversation} disabled={busy}>
          <Plus size={17} />
          {t("New conversation")}
        </button>
        <nav className="si-navigation" aria-label={t("Workspace")}>
          <button
            className={!showExample ? "is-active" : ""}
            aria-pressed={!showExample}
            onClick={() => setShowExample(false)}
          >
            <MessageCircle size={17} />
            {t("Your conversation")}
            <span className="si-nav-dot" />
          </button>
          <button
            className={showExample ? "is-active" : ""}
            aria-pressed={showExample}
            onClick={() => setShowExample(true)}
            disabled={busy}
          >
            <BookOpen size={17} />
            {t("Explore examples")}
          </button>
          <a href="/dashboard">
            <SproutMark />
            {t("Your garden")}
            <ArrowUpRight size={14} />
          </a>
        </nav>
        <div className="si-sidebar-note">
          <span>{t("A little knowledge.")}</span>
          <span>{t("A lot to grow.")}</span>
        </div>
        <div className="si-membership">
          <div className="si-membership-art" aria-hidden="true">
            <img src="/art/dashboard/sidebar-branch.png" alt="" />
          </div>
          <p className="si-eyebrow">{t("Made for your family")}</p>
          <h2>{t("Room to grow.")}</h2>
          <p>{t("Intelligence is included when you hold 1M+ SPROUT.")}</p>
          <button onClick={() => details.current?.showModal()}>
            {t("About holder access")} <ArrowUpRight size={15} />
          </button>
        </div>
        <div className="si-sidebar-footer">
          <span className={verified ? "si-status is-verified" : "si-status"} />
          <span>
            {verified
              ? short(verified.access.address)
              : t("Wallet not connected")}
          </span>
          <span style={TOGGLES}>
            <ThemeToggle />
            <LanguageToggle />
          </span>
        </div>
      </aside>

      <section
        className="si-workspace"
        id="intelligence"
        tabIndex={-1}
        aria-label={t("SPROUT Intelligence workspace")}
      >
        {selectedContext&&<aside className="si-context-note"><strong>Explain this {selectedContext.kind==='asset'?'Asset Passport':selectedContext.kind==='ledger'?'family record':'reward'}</strong><p>Sending your question shares this selected record and dated source notes with the AI. Private records must belong to your verified wallet.</p><div>{FAMILY_SOURCES.filter(s=>selectedContext.kind==='asset'?s.id!=='irs':s.id==='irs').map(s=><a key={s.id} href={s.url} target="_blank" rel="noreferrer">{s.title} · {s.date} ↗</a>)}</div></aside>}
        <header className="si-topbar">
          <div className="si-workspace-title">
            <a
              className="si-mobile-home"
              href="/"
              aria-label={t("SPROUT home")}
            >
              <SproutMark />
            </a>
            <span>Intelligence</span>
            <span className="si-title-divider">/</span>
            <span className="si-conversation-title">
              {showExample
                ? t("Explore an example")
                : inConversation
                  ? messages[0]!.content
                  : t("A fresh perspective")}
            </span>
          </div>
          <div className="si-topbar-actions">
            <LanguageToggle className="si-mobile-language" />
            <button
              className="si-icon-button si-mobile-new"
              onClick={newConversation}
              disabled={busy}
              aria-label={t("New conversation")}
            >
              <Plus size={18} />
            </button>
            <button
              className="si-icon-button"
              onClick={() => details.current?.showModal()}
              aria-label={t("About Intelligence and holder access")}
            >
              <Info size={18} />
            </button>
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
              <Wallet size={15} />
              <span>
                {connecting
                  ? t("Verifying…")
                  : verified
                    ? t("Disconnect")
                    : t("Connect wallet")}
              </span>
            </button>
          </div>
        </header>

        <div
          className={`si-scroll-area ${!inConversation && !showExample ? "si-scroll-area--welcome" : ""}`}
          ref={scrollArea}
        >
          {showExample ? (
            <div className="si-example-view">
              <div className="si-example-heading">
                <span className="si-eyebrow">{t("A place to begin")}</span>
                <h1>
                  {tj("Good questions{br}grow understanding.", { br: <br /> })}
                </h1>
                <p>
                  {t(
                    "Explore a written example, then make the question your own.",
                  )}
                </p>
              </div>
              <div className="si-example-tabs" aria-label={t("Example topics")}>
                {TOPICS.map((item, i) => (
                  <button
                    key={item.title}
                    aria-pressed={topic === i}
                    onClick={() => setTopic(i)}
                  >
                    {t(item.title)}
                  </button>
                ))}
              </div>
              <article
                className="si-example"
                aria-label={t("Authored example")}
              >
                <div className="si-example-label">
                  <SproutMark />
                  <span>{t("Written example · Not generated live")}</span>
                </div>
                <h2>{t(example.question)}</h2>
                <p>{t(example.intro)}</p>
                <ol>
                  {example.steps.map((step) => (
                    <li key={step}>{t(step)}</li>
                  ))}
                </ol>
                <a
                  href="https://www.consumerfinance.gov/consumer-tools/money-as-you-grow/"
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("Further reading: CFPB")} <ArrowUpRight size={14} />
                </a>
              </article>
              <button className="si-use-example" onClick={() => choose(topic)}>
                {t("Make this my question")} <ArrowRight size={16} />
              </button>
              {inConversation && (
                <button
                  className="si-back-chat"
                  onClick={() => setShowExample(false)}
                >
                  <ChevronLeft size={14} />
                  {t("Back to your conversation")}
                </button>
              )}
            </div>
          ) : inConversation ? (
            <div
              className="si-conversation"
              role="log"
              aria-live="polite"
              aria-busy={busy}
              aria-label={t("Conversation")}
            >
              {messages.map((message, i) => (
                <ChatMessage key={i} message={message} />
              ))}
              {busy && (
                <div className="si-thinking" role="status">
                  <span className="si-answer-mark">
                    <SproutMark />
                  </span>
                  <div>
                    <span>{t("Thinking it through")}</span>
                    <div className="si-thinking-dots" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="si-welcome">
              <div className="si-welcome-mark" aria-hidden="true">
                <SproutMark />
              </div>
              <p className="si-eyebrow">SPROUT Intelligence</p>
              <h1>
                {t("Big questions.")}
                <br />
                <em>{t("Clearer beginnings.")}</em>
              </h1>
              <p className="si-welcome-copy">
                {t("Make sense of money, together.")}
                <br />
                {t("A thoughtful space for the questions parents ask.")}
              </p>
              <div
                className="si-starters"
                aria-label={t("Suggested questions")}
              >
                <span className="si-starters-label">
                  {t("Start with something on your mind")}
                </span>
                {TOPICS.map((item, i) => (
                  <button key={item.title} onClick={() => choose(i)}>
                    <span className="si-starter-index">0{i + 1}</span>
                    <span>{t(item.question)}</span>
                    <ArrowUpRight size={17} />
                  </button>
                ))}
              </div>
              <button
                className="si-preview-link"
                onClick={() => setShowExample(true)}
              >
                {t("Just looking? Read an example")} <ArrowRight size={14} />
              </button>
            </div>
          )}
        </div>

        <div className="si-compose-dock">
          {error && (
            <div className="si-error" role="alert">
              <p>{t(error)}</p>
              <button
                className="si-icon-button"
                aria-label={t("Dismiss message")}
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {!config && !error && (
            <p className="si-availability" role="status">
              {t("Checking availability…")}
            </p>
          )}
          {config && !ready && (
            <p className="si-availability" role="status">
              {t(
                "Live answers are not available yet. You can explore a written example.",
              )}
            </p>
          )}
          {showExample ? (
            <button
              className="si-example-compose"
              onClick={() => {
                setShowExample(false);
                focusQuestion();
              }}
            >
              {t("Ask your own question")} <ArrowUp size={18} />
            </button>
          ) : (
            <form
              onSubmit={submit}
              className={`si-composer ${busy ? "is-busy" : ""}`}
            >
              <label className="si-sr-only" htmlFor="si-question">
                {t("Your question")}
              </label>
              <textarea
                id="si-question"
                ref={input}
                value={draft}
                maxLength={2500}
                rows={1}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={
                  inConversation
                    ? t("Keep the conversation growing…")
                    : t("What’s on your mind?")
                }
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
                      <span className="si-status is-verified" />
                      {t("Wallet verified")}
                    </>
                  ) : (
                    <>
                      <LockKeyhole size={13} />
                      {t("Free for 1M+ SPROUT holders")}
                    </>
                  )}
                </span>
                <div>
                  <span className="si-character-count">
                    {draft.length > 2000
                      ? `${draft.length.toLocaleString()} / 2,500`
                      : ""}
                  </span>
                  <button
                    className="si-send"
                    type="submit"
                    disabled={busy || connecting || !draft.trim() || !config}
                    aria-label={
                      verified
                        ? t("Send question")
                        : t("Verify wallet to ask")
                    }
                  >
                    {busy ? (
                      <span className="si-send-pending" />
                    ) : (
                      <ArrowUp size={20} />
                    )}
                  </button>
                </div>
              </div>
            </form>
          )}
          <div className="si-composer-note">
            <p id="si-privacy-hint">
              {t("AI can make mistakes. Not financial advice.")}
            </p>
            <button onClick={() => details.current?.showModal()}>
              {t("Privacy & access")} <ArrowUpRight size={11} />
            </button>
          </div>
        </div>
      </section>

      <dialog
        className="si-details"
        ref={details}
        aria-labelledby="si-details-title"
        onClick={(event) => {
          if (event.target === event.currentTarget) details.current?.close();
        }}
      >
        <div className="si-details-inner">
          <header>
            <span className="si-eyebrow">SPROUT Intelligence</span>
            <button
              className="si-icon-button"
              onClick={() => details.current?.close()}
              aria-label={t("Close details")}
            >
              <X size={20} />
            </button>
          </header>
          <h2 id="si-details-title">
            {tj("A little clarity,{br}included for holders.", { br: <br /> })}
          </h2>
          <p>
            {tj("Hold at least {amount} on Robinhood Chain for free access.", {
              amount: <strong>1,000,000 SPROUT</strong>,
            })}
          </p>
          <ol>
            <li>
              {t("Connect your wallet and sign a message to verify ownership.")}
            </li>
            <li>
              {t(
                "We check your balance before each answer. Your tokens stay in your wallet.",
              )}
            </li>
          </ol>
          <p className="si-details-limit">
            {t(
              "{n} questions per wallet each day, subject to service capacity.",
              { n: config?.dailyLimit ?? 40 },
            )}
          </p>
          <div className="si-contract">
            <span>{t("Token contract · Robinhood Chain")}</span>
            <div>
              <code>{INTELLIGENCE_TOKEN}</code>
              <button
                className="si-icon-button"
                onClick={copy}
                aria-label={t("Copy SPROUT contract address")}
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
            <span role="status">
              {copied ? t("Contract address copied") : ""}
            </span>
          </div>
          <div className="si-details-navigation">
            <a href="/">
              {t("Back to SPROUT")} <ArrowUpRight size={13} />
            </a>
            <a href="/dashboard">
              {t("Your garden")} <ArrowUpRight size={13} />
            </a>
            <span style={TOGGLES}>
              <ThemeToggle />
              <LanguageToggle />
            </span>
          </div>
          <h3>{t("About your conversation")}</h3>
          <p>
            {t(
              "SPROUT does not save chat transcripts. Questions go to our server and OpenAI, whose data policies apply. Refreshing, disconnecting or starting over clears your conversation.",
            )}
          </p>
          <p>{t("Leave out names, account details and wallet secrets.")}</p>
          <h3>{t("Education, not investment advice.")}</h3>
          <p>
            {t(
              "{disclaimer} Token ownership carries market risk. Access is not a recommendation to buy SPROUT.",
              { disclaimer: t(INTELLIGENCE_DISCLAIMER) },
            )}
          </p>
        </div>
      </dialog>
    </main>
  );
}

function SproutMark() {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path
        d="M16 28V17"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M15.5 19C5.5 19 3 12 3 5c8 0 14 4 12.5 14ZM17 16C17 6 23 3 30 3c0 8-5 14-13 13Z"
        fill="currentColor"
      />
    </svg>
  );
}

function ChatMessage({ message }: { message: IntelligenceMessage }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  useEffect(() => {
    if (copyState === "idle") return;
    const timer = setTimeout(() => setCopyState("idle"), 2500);
    return () => clearTimeout(timer);
  }, [copyState]);
  async function copyAnswer() {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }
  return (
    <article className={`si-message si-message--${message.role}`}>
      {message.role === "assistant" ? (
        <>
          <div className="si-answer-heading">
            <span className="si-answer-mark">
              <SproutMark />
            </span>
            <span>
              SPROUT<span className="si-answer-subtitle">Intelligence</span>
            </span>
          </div>
          <div className="si-answer-body">
            <AnswerText text={message.content} />
          </div>
          <div className="si-answer-actions">
            <button onClick={copyAnswer} aria-label={t("Copy answer")}>
              {copyState === "copied" ? (
                <Check size={14} />
              ) : (
                <Copy size={14} />
              )}
              <span>
                {copyState === "copied" ? t("Copied") : t("Copy answer")}
              </span>
            </button>
            <span role="status">
              {copyState === "failed"
                ? t("Could not copy. Please select the text.")
                : ""}
            </span>
          </div>
        </>
      ) : (
        <>
          <span className="si-sr-only">{t("You")}</span>
          <div>{message.content}</div>
        </>
      )}
    </article>
  );
}
