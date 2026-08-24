import { useState } from 'react';
import { Gift, ShieldCheck, Leaf } from 'lucide-react';

const DASHBOARD = '/dashboard';

export function GiftLanding() {
  const [link, setLink] = useState('');
  const [error, setError] = useState<string | null>(null);

  const open = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const value = link.trim();
    const idPattern = /^0x[0-9a-fA-F]{64}$/;
    let id: string | null = null;
    if (idPattern.test(value)) {
      id = value;
    } else {
      try {
        const url = new URL(value, window.location.origin);
        const match = url.pathname.match(/^\/gift\/(0x[0-9a-fA-F]{64})$/);
        if (match) id = match[1]!;
      } catch {
        id = null;
      }
    }
    if (!id) {
      // Never redirect offsite for arbitrary input; keep the value for correction.
      setError('Enter a valid gift link (…/gift/0x…) or a 0x 64-character id.');
      return;
    }
    location.href = `/gift/${id}`;
  };

  return (
    <main className="reference-landing gift-landing">
      <header className="reference-nav wrap">
        <a href="/" className="brand" aria-label="SPROUT home"><span className="brand-mark"><img src="/brand/sprout-logo.png" alt="" /></span><span>SPROUT</span></a>
        <div className="reference-nav-right">
          <a className="nav-signin" href={DASHBOARD}>Dashboard</a>
          <a className="btn button-primary" href={DASHBOARD}>Open the dashboard</a>
        </div>
      </header>

      <div className="wrap">
        <section className="reference-demo" style={{ marginTop: 40 }}>
          <div className="demo-botanical" />
          <div className="demo-emblem"><img src="/brand/sprout-logo.png" alt="SPROUT botanical emblem" /></div>
          <span className="demo-satellite" /><span className="demo-satellite two" /><span className="demo-satellite three" />
          <div className="reference-demo-copy">
            <span>Allowances &amp; gifts</span>
            <h2>A gift that keeps growing</h2>
            <p>A gift link adds funds to one fixed vault. It never grants withdrawal access.</p>
            <a className="btn button-primary" href={DASHBOARD}><Leaf size={16} />Create a gift link</a>
          </div>
        </section>

        <section className="reference-proof" style={{ gridTemplateColumns: '1fr' }}>
          <div className="reference-create" style={{ maxWidth: 620 }}>
            <h2>Have a gift link?</h2>
            <p>Paste it below to open the payment page.</p>
            <form className="create-form" onSubmit={open}>
              <input data-testid="gift-entry-input" aria-label="Gift link" placeholder="https://…/gift/0x…" value={link} onChange={(e) => setLink(e.target.value)} />
              <button data-testid="gift-entry-submit" type="submit" className="btn button-primary"><Gift size={16} />Open gift</button>
            </form>
            {error ? <p className="warning" data-testid="gift-entry-error" style={{ marginTop: 12 }}>{error}</p> : null}
            <small className="fine-print" style={{ display: 'flex', gap: 8, marginTop: 16, alignItems: 'center' }}>
              <ShieldCheck size={15} /> The link carries only an opaque id and accepted assets, never a child name or spending key.
            </small>
          </div>
        </section>

        <footer className="reference-footer" style={{ borderTop: '1px solid var(--line)', marginTop: 40 }}>
          <div className="reference-footer-copy">
            <p>Gifts go directly to a child’s sprout vault. A parent sets the accepted assets; the vault never grants the gifter any control.</p>
            <p>© {new Date().getFullYear()} SPROUT. A little, together.</p>
          </div>
        </footer>
      </div>
    </main>
  );
}
