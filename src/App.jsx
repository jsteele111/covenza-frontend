import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation, useNavigate } from "react-router-dom";
import { useAccount } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useWalletRole } from "./hooks/useWalletRole.js";
import { VisitorLanding } from "./components/VisitorLanding.jsx";
import { RoleSwitcher } from "./components/RoleSwitcher.jsx";
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

  const isWide = hasAnyRole || location.pathname === "/dashboard";

  return (
    <div style={{ minHeight: "100%", display: "flex", justifyContent: "center", padding: "0 16px" }}>
      <div style={{ width: "100%", maxWidth: isWide ? 1100 : 720 }}>
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "20px 0",
            borderBottom: "1px solid var(--hairline)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ color: "var(--brass)", fontSize: 16 }}>&#9670;</span>
              <span className="serif" style={{ fontSize: 18, fontWeight: 500, letterSpacing: "0.06em" }}>
                Covenza
              </span>
            </div>
            <Link
              to="/dashboard"
              style={{
                fontSize: 13,
                color: location.pathname === "/dashboard" ? "var(--parch)" : "var(--parch-dim)",
                textDecoration: "none",
              }}
            >
              Dashboard
            </Link>
          </div>
          <ConnectButton showBalance={false} chainStatus="icon" />
        </header>

        <main style={{ paddingTop: 20, paddingBottom: 40 }}>
          <DeploymentHealthBanner />
          {isConnected && !isLoading && <RoleSwitcher roles={roles} />}

          <Routes>
            <Route path="/" element={<VisitorLanding />} />
            <Route
              path="/dashboard"
              element={<RouteErrorBoundary><PublicDashboard /></RouteErrorBoundary>}
            />
            <Route
              path="/lender"
              element={
                <GuardedRoute allowed={roles.includes("lender")} isLoading={isLoading}>
                  <RouteErrorBoundary><LenderTab /></RouteErrorBoundary>
                </GuardedRoute>
              }
            />
            <Route
              path="/borrower"
              element={
                <GuardedRoute allowed={roles.includes("borrower")} isLoading={isLoading}>
                  <RouteErrorBoundary><BorrowerTab /></RouteErrorBoundary>
                </GuardedRoute>
              }
            />
            <Route
              path="/operator"
              element={
                <GuardedRoute allowed={roles.includes("operator")} isLoading={isLoading}>
                  <RouteErrorBoundary><OperatorTab /></RouteErrorBoundary>
                </GuardedRoute>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
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
    <div style={{
      border: "1px solid var(--brick)",
      borderRadius: 10,
      padding: "14px 16px",
      marginBottom: 16,
      background: "rgba(160,60,50,0.08)",
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
        <p key={m.address} className="mono" style={{ fontSize: 11, color: "var(--parch-dim)", margin: "2px 0" }}>
          {m.label}: {m.address}
        </p>
      ))}
    </div>
  );
}

function GuardedRoute({ allowed, isLoading, children }) {
  // Roles arrive from chain reads, so on a cold load into a deep link they
  // are briefly empty. Redirecting on that transient state bounced anyone
  // who opened /lender directly — a refresh, a bookmark, a shared link —
  // back out before the answer had arrived. Absence of a role is only
  // meaningful once the read has actually completed.
  if (isLoading) return null;
  if (!allowed) return <Navigate to="/" replace />;
  return children;
}