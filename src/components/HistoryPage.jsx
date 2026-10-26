import { useState } from "react";
import { Link } from "react-router-dom";
import { useAccount } from "wagmi";
import { IconChevronDown } from "@tabler/icons-react";
import { useLoanHistory } from "../hooks/useLoanHistory.js";
import { useMandates } from "../hooks/useMandates.js";
import { useVaultData } from "../hooks/useVaultData.js";
import { formatTokenAmount } from "../utils/format.js";
import { VaultStatement } from "./VaultStatement.jsx";
import { VaultActions } from "./VaultActions.jsx";

const DAY = 86400;

/**
 * Loan history: every closed loan the connected wallet was party to, as lender
 * or borrower, plus the lender's expired and cancelled mandates.
 *
 * Added 26 October 2026 at Jamie's request after the local click-test. Closed
 * loans used to stay on the Lend and Borrow pages, so the live ones sat under
 * an ever-growing pile of settled statements. Those pages now show only what
 * is still running; everything finished is here, newest first, one line each,
 * expanding to the full statement.
 *
 * A closed loan can still owe this wallet something — a payout the token
 * refused at settlement, claimable later. Those rows are marked and expand
 * straight into the claim, and the Lend and Borrow pages carry a banner
 * pointing here, so moving closed loans off those pages hides nothing.
 */
export function HistoryPage() {
  const { address } = useAccount();
  const { closed, isLoading, refetch } = useLoanHistory(address);
  const { mandates } = useMandates({ lenderFilter: address, onlyLive: false });
  const [filter, setFilter] = useState("all");
  const [open, setOpen] = useState(null);

  const pastMandates = mandates.filter((m) => !m.isLive).sort((a, b) => b.id - a.id);

  const shown = closed.filter((l) =>
    filter === "all" ? true : filter === "lending" ? l.role !== "borrower" : l.role !== "lender"
  );
  const lentCount = closed.filter((l) => l.role !== "borrower").length;
  const borrowedCount = closed.filter((l) => l.role !== "lender").length;
  const waiting = closed.filter((l) => l.owed.length > 0).length;

  return (
    <div>
      <div style={{ marginBottom: 22 }}>
        <h1 className="serif" style={{ fontSize: 30, fontWeight: 500, margin: "0 0 6px" }}>Loan history</h1>
        <p className="note" style={{ fontSize: 13.5, margin: 0 }}>
          Every closed loan this wallet lent or borrowed, newest first. Live loans are on the{" "}
          <Link to="/lender">Lend</Link> and <Link to="/borrower">Borrow</Link> pages.
        </p>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <div className="seg" role="tablist" aria-label="Filter loans">
          {[
            ["all", `All (${closed.length})`],
            ["lending", `Lent (${lentCount})`],
            ["borrowing", `Borrowed (${borrowedCount})`],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={filter === key}
              className={filter === key ? "active" : ""}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
        {waiting > 0 && (
          <span className="pill" style={{ color: "var(--brass)", borderColor: "rgba(184,146,90,0.45)" }}>
            {waiting} with a payout waiting to be claimed
          </span>
        )}
      </div>

      {isLoading && <p className="note">Loading…</p>}

      {!isLoading && shown.length === 0 && (
        <div className="card" style={{ textAlign: "center", padding: "28px 22px" }}>
          <p className="note" style={{ margin: 0, fontSize: 13.5 }}>
            {closed.length === 0
              ? "No closed loans yet. When a loan settles or is cancelled, it moves here."
              : "No closed loans in this view."}
          </p>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {shown.map((loan) => (
          <HistoryRow
            key={loan.address}
            loan={loan}
            open={open === loan.address}
            onToggle={() => setOpen(open === loan.address ? null : loan.address)}
            onDone={refetch}
          />
        ))}
      </div>

      {pastMandates.length > 0 && filter !== "borrowing" && (
        <div style={{ marginTop: 32 }}>
          <h2 className="section-title" style={{ fontSize: 22, marginBottom: 8 }}>Past mandates</h2>
          <p className="note" style={{ margin: "0 0 12px" }}>
            Terms you published that can no longer be filled — expired, cancelled, or withdrawn with
            “cancel all”.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {pastMandates.map((m) => (
              <div key={m.id} className="card" style={{ padding: "14px 18px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13.5, color: "var(--parch)" }}>
                    Mandate #{m.id} · {formatTokenAmount(m.minPrincipal, m.decimals)}–{formatTokenAmount(m.maxPrincipal, m.decimals)}{" "}
                    {m.symbol} · {m.minTermSeconds / DAY}–{m.maxTermSeconds / DAY}d · {m.maxTierLabel}
                  </span>
                  <span className="note" style={{ margin: 0 }}>
                    lent {formatTokenAmount(m.filled, m.decimals)} of {formatTokenAmount(m.totalCapacity, m.decimals)} {m.symbol}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const OUTCOME_COLOURS = { 0: "var(--sage)", 1: "var(--slate)", 2: "var(--brick)", 3: "var(--slate)" };

function HistoryRow({ loan, open, onToggle, onDone }) {
  const amount = (v) => (v != null ? `${formatTokenAmount(v, loan.decimals)} ${loan.symbol}` : "—");
  const verb = loan.role === "borrower" ? "Borrowed" : "Lent";
  const received = loan.role === "borrower" ? loan.settledBorrowerPayout : loan.settledLenderPayout;
  const outcome = loan.cancelled ? "Cancelled — deposit never paid" : loan.severityLabel?.replace(/^Settled with /, "");
  const colour = loan.cancelled ? "var(--parch-dim)" : OUTCOME_COLOURS[loan.severity];
  const days = loan.termSeconds ? loan.termSeconds / DAY : null;
  const date = loan.originatedAt ? new Date(loan.originatedAt * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <button type="button" className="history-row" onClick={onToggle} aria-expanded={open}>
        <span className="history-main">
          <span className="history-title">
            {verb} {amount(loan.principal)}
            {loan.role === "both" && <span className="note" style={{ margin: 0 }}> · lender and borrower</span>}
          </span>
          <span className="note" style={{ margin: 0 }}>
            {date}
            {days !== null && ` · ${days >= 1 ? `${Math.round(days * 10) / 10} day${days === 1 ? "" : "s"}` : `${loan.termSeconds}s`}`}
            {loan.aprBps !== undefined && ` · ${loan.aprBps / 100}% APR`}
          </span>
        </span>
        <span className="history-outcome" style={{ color: colour }}>
          {outcome && outcome.charAt(0).toUpperCase() + outcome.slice(1)}
        </span>
        <span className="history-received">
          <span className="note" style={{ margin: 0, fontSize: 11 }}>You received</span>
          <span className="mono" style={{ fontSize: 13.5, color: "var(--parch)" }}>{amount(received)}</span>
          {loan.owed.length > 0 && (
            <span style={{ fontSize: 11, color: "var(--brass)" }}>
              + {loan.owed.map((o) => `${o.display} ${o.symbol}`).join(", ")} to claim
            </span>
          )}
        </span>
        <IconChevronDown
          size={18}
          aria-hidden="true"
          style={{ color: "var(--parch-dim)", transform: open ? "rotate(180deg)" : "none", transition: "transform 160ms" }}
        />
      </button>
      {open && <LoanDetail loan={loan} onDone={onDone} />}
    </div>
  );
}

function LoanDetail({ loan, onDone }) {
  const { vault, refetch } = useVaultData(loan.address);
  if (!vault) return <p className="note" style={{ padding: "0 20px 18px" }}>Loading…</p>;
  return (
    <div style={{ padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
      <VaultStatement vault={vault} />
      <VaultActions
        vault={vault}
        role={loan.role === "borrower" ? "borrower" : "lender"}
        onDone={() => { refetch(); onDone?.(); }}
      />
    </div>
  );
}

/**
 * Shown on Lend and Borrow when a closed loan still owes this wallet a payout.
 * Closed loans no longer appear on those pages, so without this a refused
 * payout would be out of sight.
 */
export function UnclaimedBanner({ address }) {
  const { unclaimed } = useLoanHistory(address);
  if (unclaimed.length === 0) return null;
  return (
    <div className="notice-bar" role="status">
      <span>
        {unclaimed.length === 1 ? "A closed loan has" : `${unclaimed.length} closed loans have`} a payout waiting
        for you to claim.
      </span>
      <Link to="/history" className="btn btn-primary btn-auto" style={{ padding: "7px 14px" }}>
        Go to loan history
      </Link>
    </div>
  );
}
