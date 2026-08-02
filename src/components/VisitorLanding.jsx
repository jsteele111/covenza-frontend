import { Link } from "react-router-dom";

/**
 * Shown at "/" whenever the connected wallet has no detected role yet —
 * or nothing is connected at all. Deliberately makes no assumption about
 * which role the person wants; both paths are presented equally, and
 * neither is a route this component redirects into automatically (that
 * only happens once a REAL role is detected on-chain — see App.jsx).
 */
export function VisitorLanding() {
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <InfoCard
          title="Become a lender"
          body="Publish the terms you'll lend on and let borrowers take them, or originate directly for a borrower you know."
        />
        <InfoCard
          title="Get verified to borrow"
          body="Complete identity verification, then take any published mandate that suits you — no introduction needed."
        />
      </div>

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

function InfoCard({ title, body }) {
  return (
    <div
      style={{
        background: "var(--panel)",
        border: "0.5px solid var(--hairline)",
        borderRadius: 10,
        padding: 20,
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 600, color: "var(--parch)", marginBottom: 8 }}>
        {title}
      </div>
      <div style={{ fontSize: 13, color: "var(--parch-dim)", lineHeight: 1.5 }}>{body}</div>
    </div>
  );
}