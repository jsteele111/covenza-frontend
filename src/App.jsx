import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation, useNavigate } from "react-router-dom";
import { useAccount } from "wagmi";
import { useWalletRole } from "./hooks/useWalletRole.js";
import { VisitorLanding } from "./components/VisitorLanding.jsx";
import { TestnetBar, SiteHeader, SiteFooter } from "./components/SiteChrome.jsx";
import { RouteErrorBoundary } from "./components/RouteErrorBoundary.jsx";
import { PublicDashboard } from "./components/PublicDashboard.jsx";
// Existing v1 view components — kept functional here as-is. Each is
// rewritten for v2 in its own group (E4 lender, E5 borrower, E6
// operator); until then they render inside the new routed shell exactly
// as before, so the app stays usable at every step of the rebuild.
import { useDeploymentHealth } from "./hooks/useDeploymentHealth.js";
import { LenderTab } from "./components/LenderTab.jsx";
import { BorrowerTab } from "./components/BorrowerTab.jsx";
import { OperatorTab } from "./components/OperatorTab.jsx";
import { HistoryPage } from "./components/HistoryPage.jsx";

const ROLE_PRIORITY = ["operator", "lender", "borrower"];

export default function App() {
  return (
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  );
}

function Shell() {
  const { isConnected } = useAccount();
  const { roles, isLoading, hasAnyRole, hasEstablishedRole } = useWalletRole();
  const location = useLocation();
  const navigate = useNavigate();

  // Auto-redirect ONLY away from "/" and ONLY once a real role is
  // detected on-chain — never on any other path, and never guessed
  // ahead of the actual read completing. Priority order: operator over
  // lender over borrower, since it's the rarer, more privileged role;
  // the switcher (if more than one role applies) lets the person move
  // freely from there regardless of which one they land on first.
  // Keyed on hasEstablishedRole, not hasAnyRole: every connected wallet can
  // lend, so redirecting on capability would drop a first-time visitor onto
  // the lender form and hide the borrower onboarding path entirely.
  useEffect(() => {
    if (isLoading || !hasEstablishedRole) return;
    if (location.pathname !== "/") return;
    const primary = ROLE_PRIORITY.find((r) => roles.includes(r));
    if (primary) navigate(`/${primary}`, { replace: true });
  }, [isLoading, hasEstablishedRole, roles, location.pathname, navigate]);

  // The role views and the dashboard carry wide tables and two-column
  // layouts; the connect prompts read better at a narrower measure.
  const isWide =
    hasAnyRole || location.pathname === "/dashboard" || location.pathname === "/" ||
    location.pathname === "/operator" || location.pathname === "/history";

  return (
    <>
      <TestnetBar />
      {/* The header's nav replaces the old role-switcher row: Lend and Borrow
          are always listed, Operator only for the wallet holding the role. */}
      <SiteHeader roles={isConnected && !isLoading ? roles : []} connected={isConnected} />

        <main className={`page${isWide ? "" : " narrow"}`}>
          <DeploymentHealthBanner />

          <Routes>
            <Route path="/" element={<VisitorLanding />} />
            <Route
              path="/dashboard"
              element={<RouteErrorBoundary><PublicDashboard /></RouteErrorBoundary>}
            />
            {/* Lending is permissionless: a connected wallet is the only
                requirement. */}
            <Route
              path="/lender"
              element={
                <GuardedRoute
                  allowed={isConnected}
                  isLoading={isLoading}
                  reason="Lending needs a connected wallet. Sanctions screening is checked on the page, which will guide you through it."
                >
                  <RouteErrorBoundary><LenderTab /></RouteErrorBoundary>
                </GuardedRoute>
              }
            />
            {/* Borrowing needs verification, but the ROUTE must not: the
                verification gate lives inside BorrowerTab, and gating the
                route on the very status the gate exists to help you obtain
                made that gate unreachable by everyone who needed it. The
                landing page said "Get verified to borrow" and the route
                bounced you for not being verified. Same bootstrap trap that
                was fixed for lenders and left open here. */}
            <Route
              path="/borrower"
              element={
                <GuardedRoute
                  allowed={isConnected}
                  isLoading={isLoading}
                  reason="Borrowing needs a connected wallet. Verification is the next step, and this page will guide you through it."
                >
                  <RouteErrorBoundary><BorrowerTab /></RouteErrorBoundary>
                </GuardedRoute>
              }
            />
            {/* Deliberately unguarded. Everything the operator view reads —
                assets, tiers, attesters, pool configuration — is public on
                chain, and some of it already appears on the dashboard. The
                write actions check the role themselves.

                It was guarded until the operator role moved to a Safe, at
                which point the route became unreachable by anyone at all: the
                Safe holds the role but cannot browse, and the deploying key
                can browse but no longer holds the role. Gating reads on a
                credential no browser can present is a guarantee that nobody
                sees the page. */}
            <Route
              path="/history"
              element={
                <GuardedRoute
                  allowed={isConnected}
                  isLoading={isLoading}
                  reason="Loan history is per wallet. Connect the wallet whose loans you want to see."
                >
                  <RouteErrorBoundary><HistoryPage /></RouteErrorBoundary>
                </GuardedRoute>
              }
            />
            <Route
              path="/operator"
              element={<RouteErrorBoundary><OperatorTab /></RouteErrorBoundary>}
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>

      <SiteFooter />
    </>
  );
}

/**
 * Guards a role route against direct navigation by a wallet that doesn't
 * actually hold that role — typing /operator in manually, an old
 * bookmark after a role changed, etc. Sends them back to "/" rather than
 * showing content (or an error) for a role they don't have. This is the
 * real enforcement; the operator route being unlinked from the landing
 * page is just the social nicety on top of it, not the actual guard.
 */
/**
 * Announces a wiped deployment rather than rendering zeros over it.
 *
 * Deliberately a banner and not a blocking screen: the addresses may be stale
 * for only part of the stack, and a reader who understands that is better
 * served by seeing the app with a warning than by being locked out of it.
 */
function DeploymentHealthBanner() {
  const { status, missing } = useDeploymentHealth();
  if (status !== "wiped") return null;

  return (
    <div className="card" style={{
      borderColor: "var(--brick)",
      marginBottom: 16,
      background: "rgba(207,107,93,0.08)",
    }}>
      <p style={{ fontSize: 13, fontWeight: 600, color: "var(--brick)", margin: "0 0 6px" }}>
        This deployment is gone
      </p>
      <p style={{ fontSize: 12, color: "var(--parch-dim)", margin: "0 0 8px", lineHeight: 1.6 }}>
        There is no contract code at {missing.length === 1 ? "this address" : "these addresses"} any
        more. Robinhood testnet periodically wipes contract state while keeping balances and block
        height, so everything below will read as empty rather than failing — which is why this
        notice exists at all. Redeploy and update <span className="mono">contracts.js</span>.
      </p>
      {missing.map((m) => (
        <p key={m.address} className="mono" style={{ fontSize: 12, color: "var(--parch-dim)", margin: "2px 0" }}>
          {m.label}: {m.address}
        </p>
      ))}
    </div>
  );
}

function GuardedRoute({ allowed, isLoading, reason, children }) {
  // Roles arrive from chain reads, so on a cold load into a deep link they
  // are briefly empty. Redirecting on that transient state bounced anyone
  // who opened /lender directly — a refresh, a bookmark, a shared link —
  // back out before the answer had arrived. Absence of a role is only
  // meaningful once the read has actually completed.
  if (isLoading) return null;

  // Say why, rather than redirecting silently.
  //
  // The old behaviour sent you to "/" with no message. Following a shared
  // link to /borrower without a wallet connected was indistinguishable from
  // the link being broken — and before the landing page had working routes,
  // it dropped you somewhere offering no way forward.
  if (!allowed) {
    return (
      <div className="card" style={{ padding: "26px 28px" }}>
        <p style={{ fontSize: 15, fontWeight: 600, color: "var(--parch)", margin: "0 0 8px" }}>
          Connect a wallet to continue
        </p>
        <p style={{ fontSize: 13, color: "var(--parch-dim)", margin: "0 0 14px", lineHeight: 1.6 }}>
          {reason}
        </p>
        <Link to="/dashboard" style={{ fontSize: 13, color: "var(--slate)", textDecoration: "none" }}>
          Or view the protocol dashboard — no wallet required &rarr;
        </Link>
      </div>
    );
  }

  return children;
}