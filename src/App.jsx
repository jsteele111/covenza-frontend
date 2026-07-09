import { useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { LenderTab } from "./components/LenderTab.jsx";
import { BorrowerTab } from "./components/BorrowerTab.jsx";

export default function App() {
  const [tab, setTab] = useState("borrower");

  return (
    <div style={{ minHeight: "100%", display: "flex", justifyContent: "center", padding: "0 16px" }}>
      <div style={{ width: "100%", maxWidth: 560 }}>
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "20px 0",
            borderBottom: "1px solid var(--hairline)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ color: "var(--brass)", fontSize: 16 }}>&#9670;</span>
            <span className="serif" style={{ fontSize: 18, fontWeight: 500, letterSpacing: "0.06em" }}>
              Covenza
            </span>
          </div>
          <ConnectButton showBalance={false} chainStatus="icon" />
        </header>

        <nav style={{ display: "flex", borderBottom: "1px solid var(--hairline)", marginBottom: 20 }}>
          <TabButton active={tab === "lender"} onClick={() => setTab("lender")}>
            Lender
          </TabButton>
          <TabButton active={tab === "borrower"} onClick={() => setTab("borrower")}>
            Borrower
          </TabButton>
        </nav>

        <main style={{ paddingBottom: 40 }}>
          {tab === "lender" ? <LenderTab /> : <BorrowerTab />}
        </main>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: "transparent",
        border: "none",
        borderBottom: active ? "2px solid var(--brass)" : "2px solid transparent",
        color: active ? "var(--parch)" : "var(--parch-dim)",
        fontWeight: active ? 500 : 400,
        fontSize: 13,
        padding: "12px 18px",
        marginBottom: -1,
      }}
    >
      {children}
    </button>
  );
}
