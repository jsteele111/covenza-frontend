import { Component } from "react";

/**
 * Wraps each routed view so a crash in ONE component — very possible
 * right now, mid-rebuild, since several v1 components (LenderTab,
 * useLatestVault, etc.) haven't been rewritten for v2 yet and may throw
 * on data shapes that no longer match — shows a visible, actionable
 * error instead of taking down the entire app with a blank white screen.
 *
 * This happened twice in a row during Group E (the AAVE export removal,
 * then a VAULT_FACTORY_ABI event-shape mismatch) — both should have
 * shown SOMETHING rather than nothing. This is the fix for the whole
 * class of failure, not just one instance of it.
 */
export class RouteErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("[RouteErrorBoundary] A view crashed:", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            background: "var(--panel)",
            border: "1px solid var(--brick)",
            borderRadius: 10,
            padding: 20,
          }}
        >
          <div style={{ color: "var(--brick)", fontWeight: 600, marginBottom: 8 }}>
            This view hit an error
          </div>
          <div style={{ color: "var(--parch-dim)", fontSize: 13, marginBottom: 12 }}>
            Likely cause during this rebuild: a component here hasn't been updated
            for the v2 contracts yet. Check the browser console for the specific error.
          </div>
          <div
            style={{
              fontFamily: "monospace",
              fontSize: 12,
              color: "var(--parch-dim)",
              background: "var(--ink)",
              padding: 10,
              borderRadius: 6,
              overflowX: "auto",
            }}
          >
            {this.state.error.message}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
