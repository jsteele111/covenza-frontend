export function ActionButton({ label, onClick, disabled, disabledReason, primary, loading }) {
  return (
    <div style={{ flex: 1 }}>
      <button
        onClick={onClick}
        disabled={disabled || loading}
        style={{
          width: "100%",
          background: primary && !disabled ? "var(--brass)" : "transparent",
          color: primary && !disabled ? "var(--ink)" : "var(--parch-dim)",
          border: primary && !disabled ? "none" : "1px solid var(--hairline)",
          borderRadius: 8,
          padding: 11,
          fontSize: 13,
          fontWeight: 500,
        }}
      >
        {loading ? "Confirming..." : label}
      </button>
      {disabled && disabledReason && (
        <p style={{ fontSize: 11, color: "var(--parch-dim)", margin: "8px 2px 0" }}>{disabledReason}</p>
      )}
    </div>
  );
}
