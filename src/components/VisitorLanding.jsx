import { Link } from "react-router-dom";

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
 */
export function VisitorLanding() {
  return (
    <div>
      <TestnetNotice />

      <section style={{ marginBottom: 28 }}>
        <h1
          className="serif"
          style={{ fontSize: 30, fontWeight: 500, color: "var(--parch)", margin: "0 0 12px", lineHeight: 1.25 }}
        >
          Borrow against a deposit worth less than the loan
        </h1>
        <p style={{ fontSize: 15, color: "var(--parch-dim)", margin: "0 0 12px", lineHeight: 1.65 }}>
          Covenza is a fixed-term lending protocol for tokenised assets. A borrower posts a deposit
          well below the principal rather than the 100–150% that over-collateralised lending
          demands. The principal never reaches their wallet: it sits in a vault that can only hold
          whitelisted assets, within limits fixed when the loan was written.
        </p>
        <p style={{ fontSize: 15, color: "var(--parch-dim)", margin: 0, lineHeight: 1.65 }}>
          It is <Em>low-collateral, not uncollateralised</Em>, and it is{" "}
          <Em>non-liquidating</Em> — there are no margin calls and no forced closure mid-term.
          That is the point of the product, and it is why the deposit floors, exposure caps and
          term limits are as strict as they are. They do the job liquidation does elsewhere.
        </p>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <ActionCard
          to="/lender"
          title="Lend"
          body="Publish terms a borrower can take without asking you first, or originate directly for a borrower you know. Your capital stays in your wallet until a loan is filled."
          note="No verification required"
        />
        <ActionCard
          to="/borrower"
          title="Borrow"
          body="Get an attestation from a recognised provider, then take any published mandate that suits you — no introduction needed."
          note="Identity verification required"
        />
      </div>

      <RiskNotice />

      <Link
        to="/dashboard"
        style={{
          display: "block",
          marginTop: 16,
          textAlign: "center",
          fontSize: 13,
          color: "var(--slate)",
          textDecoration: "none",
        }}
      >
        View protocol dashboard — no wallet required &rarr;
      </Link>
    </div>
  );
}

const Em = ({ children }) => (
  <span style={{ color: "var(--parch)", fontWeight: 600 }}>{children}</span>
);

/**
 * Every figure on this site is play money. Said once, at the top, rather than
 * relying on the reader inferring it from token names beginning with "t".
 */
function TestnetNotice() {
  return (
    <div
      style={{
        border: "1px solid var(--hairline)",
        borderLeft: "3px solid var(--brass)",
        borderRadius: 8,
        padding: "10px 14px",
        marginBottom: 24,
        background: "var(--panel)",
      }}
    >
      <p style={{ fontSize: 12.5, color: "var(--parch-dim)", margin: 0, lineHeight: 1.6 }}>
        <span style={{ color: "var(--brass)", fontWeight: 600 }}>Testnet.</span>{" "}
        This runs on Robinhood Chain testnet. Every token here is a test token with no value, and
        the protocol has not been independently audited. Nothing on this site involves real money.
      </p>
    </div>
  );
}

/**
 * REG-4 requires that public materials disclose the risk of loss to BOTH sides.
 * Neither public page said anything about risk before this.
 *
 * Deliberately specific rather than a generic disclaimer: a lender's real
 * exposure is the insurance cap, and a borrower's is the whole deposit. Vague
 * warnings are ignored; numbers are not.
 */
function RiskNotice() {
  return (
    <div
      style={{
        border: "1px solid var(--hairline)",
        borderRadius: 10,
        padding: "16px 18px",
        background: "var(--panel)",
      }}
    >
      <p style={{ fontSize: 13, fontWeight: 600, color: "var(--parch)", margin: "0 0 8px" }}>
        Both sides can lose money
      </p>
      <p style={{ fontSize: 12.5, color: "var(--parch-dim)", margin: "0 0 6px", lineHeight: 1.6 }}>
        <Em>Borrowers</Em> put their deposit at risk. It absorbs the loss on the position first,
        and it can be lost entirely.
      </p>
      <p style={{ fontSize: 12.5, color: "var(--parch-dim)", margin: 0, lineHeight: 1.6 }}>
        <Em>Lenders</Em> are protected by the borrower's deposit and then by a shared insurance
        pool — but the pool pays a capped share of principal per loan, and a loss beyond that is
        the lender's. The cap is shown before you commit to any loan.
      </p>
    </div>
  );
}

function ActionCard({ to, title, body, note }) {
  return (
    <Link
      to={to}
      style={{
        display: "block",
        background: "var(--panel)",
        border: "0.5px solid var(--hairline)",
        borderRadius: 10,
        padding: 20,
        textDecoration: "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: "var(--parch)" }}>{title}</span>
        <span style={{ fontSize: 15, color: "var(--brass)" }}>&rarr;</span>
      </div>
      <div style={{ fontSize: 13, color: "var(--parch-dim)", lineHeight: 1.5, marginBottom: 10 }}>{body}</div>
      <div style={{ fontSize: 11, color: "var(--slate)" }}>{note}</div>
    </Link>
  );
}
