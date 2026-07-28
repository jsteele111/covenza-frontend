import { useLocation, useNavigate } from "react-router-dom";

const ROLE_LABELS = { operator: "Operator", lender: "Lender", borrower: "Borrower" };

/**
 * Persistent switcher for a wallet with more than one detected role.
 * Includes EVERY role the connected wallet genuinely holds, operator
 * included — a wallet that is both operator and lender (a real,
 * ongoing case: the test wallet used throughout this project's own
 * development) needs to move freely between both, not have one hidden.
 * What operator does NOT get is a casual invitation from the visitor
 * landing page — that distinction is handled in App.jsx's redirect
 * logic, not by hiding it here once a wallet has proven the role.
 *
 * Renders nothing at all for a single-role wallet — no switcher, no
 * tabs, nothing to click between, by design.
 */
export function RoleSwitcher({ roles }) {
  const location = useLocation();
  const navigate = useNavigate();

  if (roles.length < 2) return null;

  return (
    <div
      style={{
        display: "inline-flex",
        background: "var(--panel)",
        border: "0.5px solid var(--hairline)",
        borderRadius: 8,
        padding: 3,
        marginBottom: 16,
      }}
    >
      {roles.map((role) => {
        const path = `/${role}`;
        const active = location.pathname === path;
        return (
          <button
            key={role}
            onClick={() => navigate(path)}
            style={{
              border: "none",
              borderRadius: 6,
              padding: "6px 14px",
              fontSize: 13,
              cursor: "pointer",
              background: active ? "var(--brass)" : "transparent",
              color: active ? "#1C1C1A" : "var(--parch-dim)",
              fontWeight: active ? 600 : 400,
            }}
          >
            {ROLE_LABELS[role] || role}
          </button>
        );
      })}
    </div>
  );
}
