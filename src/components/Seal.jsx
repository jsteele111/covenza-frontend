import { IconLockOpen, IconLock, IconAlertTriangle, IconMinus } from "@tabler/icons-react";

// The one recurring visual motif across the app: a circular seal showing
// a vault's lifecycle state at a glance.
//
// Note: once a vault is settled, this shows a generic "Settled" state
// rather than distinguishing repaid vs. defaulted, since that distinction
// only lives in past event logs, not current contract state, and this
// demo reads live state rather than indexing history.
export function Seal({ vault }) {
  let color = "var(--parch-dim)";
  let Icon = IconMinus;
  let label = "No vault";

  if (vault) {
    if (vault.isSettled) {
      color = "var(--slate)";
      Icon = IconLock;
      label = "Settled";
    } else if (vault.isExpired) {
      color = "var(--brick)";
      Icon = IconAlertTriangle;
      label = "Needs settlement";
    } else {
      color = "var(--brass)";
      Icon = IconLockOpen;
      label = "Active";
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <div
        style={{
          width: 38,
          height: 38,
          borderRadius: "50%",
          border: `2px solid ${color}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon size={17} color={color} aria-hidden="true" />
      </div>
      <span style={{ fontSize: 10, color }}>{label}</span>
    </div>
  );
}
