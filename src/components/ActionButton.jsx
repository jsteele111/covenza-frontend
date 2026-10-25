/**
 * The app's action button. Styled by the shared .btn classes (index.css) so
 * it has hover, pressed and keyboard-focus states; a disabled button says why
 * underneath rather than just greying out.
 */
export function ActionButton({ label, onClick, disabled, disabledReason, primary, loading }) {
  const isPrimary = primary && !disabled;
  return (
    <div style={{ flex: 1 }}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={`btn${isPrimary ? " btn-primary" : ""}`}
      >
        {loading ? "Confirming..." : label}
      </button>
      {disabled && disabledReason && (
        <p className="note" style={{ margin: "8px 2px 0" }}>{disabledReason}</p>
      )}
    </div>
  );
}
