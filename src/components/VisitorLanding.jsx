import { Link } from "react-router-dom";
import { IconLock, IconCoins, IconShieldCheck, IconUmbrella, IconArrowRight } from "@tabler/icons-react";

/**
 * Shown at "/" whenever the connected wallet has no ESTABLISHED role yet —
 * or nothing is connected at all.
 *
 * Rewritten 5 August 2026 after the UI review. Three things were wrong, and
 * they compounded:
 *
 *   1. The two cards looked like the page's primary calls to action and were
 *      inert divs. Nothing linked anywhere except the dashboard.
 *   2. The page never said what Covenza is. A visitor arriving from a link had
 *      no way to learn what the product does without connecting a wallet.
 *   3. There was no risk disclosure and no indication this is a testnet, both
 *      of which the BRD requires of any public-facing surface (REG-4).
 *
 * The original design intent — do not REDIRECT someone into a role they have
 * not chosen — was right and is preserved. It had been implemented as "do not
 * link to either role", which is a different thing and left an unconnected
 * visitor with nowhere to go.
 *
 * October 2026 refresh: a hero with the two calls to action up front, four
 * short tiles on what makes the product different, a three-step outline of a
 * loan, then the role cards and the risk notice. The testnet notice moved to
 * the bar at the top of every page (SiteChrome.TestnetBar), so it is no longer
 * repeated here. The risk notice's wording is unchanged.
 */
export function VisitorLanding() {
  return (
    <div>
      <section className="hero">
        <span className="eyebrow">Fixed-term lending · Robinhood Chain</span>
        <h1>
          Borrow against a deposit <em>worth less</em> than the loan
        </h1>
        <p className="lede">
          Covenza is a fixed-term lending protocol for tokenised assets. A borrower posts a deposit
          well below the principal rather than the 100–150% that over-collateralised lending
          demands. The principal never reaches their wallet: it sits in a vault that can only hold
          whitelisted assets, within limits fixed when the loan was written.
        </p>
        <p className="lede">
          It is <strong>low-collateral, not uncollateralised</strong>, and it is{" "}
          <strong>non-liquidating</strong> — there are no margin calls and no forced closure
          mid-term.
        </p>
        <div className="cta-row">
          <Link to="/borrower" className="btn btn-primary btn-lg btn-auto">
            Start borrowing <IconArrowRight size={17} aria-hidden="true" />
          </Link>
          <Link to="/lender" className="btn btn-lg btn-auto">
            Start lending
          </Link>
          <Link to="/dashboard" className="btn btn-lg btn-auto" style={{ border: "none" }}>
            View the dashboard
          </Link>
        </div>
      </section>

      <div className="feature-grid">
        <Feature icon={IconLock} title="No liquidations">
          Nothing is closed out mid-term. Deposit floors, exposure caps and term limits do the job
          liquidation does elsewhere — which is why they are strict.
        </Feature>
        <Feature icon={IconCoins} title="Deposit below the loan">
          The deposit is sized to the risk of the assets the borrower may hold and the length of
          the loan, not to the full principal.
        </Feature>
        <Feature icon={IconShieldCheck} title="Principal stays in a vault">
          The borrower directs the principal but never holds it. The vault can only hold whitelisted
          assets, within limits agreed at the start.
        </Feature>
        <Feature icon={IconUmbrella} title="Insured, within stated limits">
          After the borrower's deposit, a shared insurance pool covers lenders — up to caps shown
          before any loan is agreed.
        </Feature>
      </div>

      <h2 className="section-title">How a loan works</h2>
      <div className="steps">
        <div className="step">
          <h3>A lender publishes terms</h3>
          <p>
            A rate that moves with the term and the deposit, a size per loan and a total capacity.
            The capital stays in the lender's wallet until someone takes the terms.
          </p>
        </div>
        <div className="step">
          <h3>A verified borrower takes them</h3>
          <p>
            They choose size, term and deposit. The principal and deposit move into a new vault, and
            the insurance premium into the pool, in one transaction — all of it or none of it.
          </p>
        </div>
        <div className="step">
          <h3>It settles at the deadline</h3>
          <p>
            Held assets are sold back close to their time-weighted average price. The lender is repaid
            first; the deposit absorbs any loss, then the insurance pool; the borrower keeps the rest.
          </p>
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: 16 }}>
        <RoleCard
          to="/lender"
          title="Lend"
          body="Publish terms a borrower can take without asking you first, or originate directly for a borrower you know. Your capital stays in your wallet until a loan is filled."
          note="Sanctions screening required"
        />
        <RoleCard
          to="/borrower"
          title="Borrow"
          body="Get an attestation from a recognised provider, then take any published mandate that suits you — no introduction needed."
          note="Identity verification required"
        />
      </div>

      <RiskNotice />
    </div>
  );
}

function Feature({ icon: Icon, title, children }) {
  return (
    <div className="feature">
      <span className="feature-icon">
        <Icon size={19} aria-hidden="true" />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

function RoleCard({ to, title, body, note }) {
  return (
    <Link to={to} className="card role-card">
      <div className="role-card-head">
        <h3>{title}</h3>
        <IconArrowRight className="arrow" size={20} aria-hidden="true" />
      </div>
      <p>{body}</p>
      <span className="pill">{note}</span>
    </Link>
  );
}

/**
 * REG-4 requires that public materials disclose the risk of loss to BOTH sides.
 *
 * Deliberately specific rather than a generic disclaimer: a lender's real
 * exposure is the insurance cap, and a borrower's is the whole deposit. Vague
 * warnings are ignored; numbers are not.
 */
function RiskNotice() {
  return (
    <div className="card" style={{ borderLeft: "3px solid var(--brick)" }}>
      <p style={{ fontSize: 14, fontWeight: 600, color: "var(--parch)", margin: "0 0 10px" }}>
        Both sides can lose money
      </p>
      <p className="note" style={{ fontSize: 13, margin: "0 0 8px" }}>
        <Em>Borrowers</Em> put their deposit at risk. It absorbs the loss on the position first,
        and it can be lost entirely.
      </p>
      <p className="note" style={{ fontSize: 13, margin: 0 }}>
        <Em>Lenders</Em> are protected by the borrower's deposit and then by a shared insurance
        pool — but the pool pays at most a capped share of the loan's principal, and of its own
        reserve, per loan, and a loss beyond that is the lender's. Both caps are shown before you
        commit to any loan.
      </p>
    </div>
  );
}

const Em = ({ children }) => (
  <span style={{ color: "var(--parch)", fontWeight: 600 }}>{children}</span>
);
