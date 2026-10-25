import { useState } from "react";
import { useChainId, useWriteContract, usePublicClient } from "wagmi";
import { KYC_REGISTRY_ABI } from "../config/abis.js";
import { getContractsForChain, CLAIM_LABELS } from "../config/contracts.js";
import { useAttesters } from "../hooks/useAttesters.js";
import { useEligibility } from "../hooks/useEligibility.js";

// A local signing service, for development only.
//
// Gated on import.meta.env.DEV as well as the variable, so a production build
// cannot show it whatever the host's environment says. Relying on "unset it in
// production" was not good enough: the variable WAS set on the deployed site,
// pointing at a serverless function that signed attestations against a registry
// on a chain this app no longer supports. Nobody had unset anything, because
// nobody had to remember to until it mattered.
//
// A build-time guard cannot be forgotten. An environment variable can.
const MOCK_VERIFIER_URL = import.meta.env.DEV
  ? (import.meta.env.VITE_VERIFIER_SERVICE_URL || "")
  : "";

/**
 * The eligibility gate, for borrowers and — since October 2026 — lenders.
 *
 * Covenza performs no identity check, issues no attestation, and collects no
 * personal data. It reads evidence that a recognised provider produced
 * independently. That is the whole of the design, and this screen exists to
 * make it legible: an earlier version asked for name, email and jurisdiction
 * and then discarded them, which taught exactly the opposite — that the
 * protocol takes custody of identity.
 *
 * October 2026 (frozen contracts, #7): an attestation now carries CLAIMS —
 * identity verified, sanctions screened, jurisdiction eligible — and an
 * expiry, and the factory requires a set of claims of each side: all three of
 * a borrower by default, sanctions screening of a lender. So "verified" is no
 * longer the question. A wallet admitted once can lapse, or carry fewer claims
 * than its role needs, and this screen says which.
 *
 * @param role "borrower" | "lender"
 */
export function KycGate({ address, role = "borrower", onEligible }) {
  const chainId = useChainId();
  const contracts = getContractsForChain(chainId);
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const { live: providers, legacy, isLoading: loadingProviders } = useAttesters();
  const elig = useEligibility(address, role);

  const [form, setForm] = useState({ claims: "", validUntil: "", deadline: "", signature: "" });
  const [status, setStatus] = useState("idle");
  const [errorMessage, setErrorMessage] = useState(null);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Providers commonly hand over the whole attestation as one JSON object.
  // Pasting that into the signature box fills every field.
  function onSignaturePaste(e) {
    const text = e.clipboardData?.getData("text") || "";
    if (!text.trim().startsWith("{")) return;
    try {
      const a = JSON.parse(text);
      if (a.signature) {
        e.preventDefault();
        setForm({
          claims: String(a.claims ?? ""),
          validUntil: String(a.validUntil ?? ""),
          deadline: String(a.deadline ?? a.expiry ?? ""),
          signature: a.signature,
        });
      }
    } catch { /* not JSON; paste as typed */ }
  }

  async function present(a) {
    setErrorMessage(null);
    setStatus("submitting");
    try {
      const fees = await publicClient.estimateFeesPerGas();
      const hash = await writeContractAsync({
        address: contracts.kycRegistry,
        abi: KYC_REGISTRY_ABI,
        functionName: "verifyWithSignature",
        args: [address, BigInt(a.claims), BigInt(a.validUntil), BigInt(a.deadline), a.signature],
        maxFeePerGas: fees.maxFeePerGas * 2n,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The transaction was mined but reverted.");
      elig.refetch();
      onEligible?.();
      setStatus("idle");
      setForm({ claims: "", validUntil: "", deadline: "", signature: "" });
    } catch (err) {
      setErrorMessage(err.shortMessage || err.message || "Something went wrong.");
      setStatus("error");
    }
  }

  // Development only: fetches an attestation from the local mock signer, then
  // presents it down exactly the same path a real one would take.
  async function useMockProvider() {
    setErrorMessage(null);
    setStatus("requesting");
    try {
      const res = await fetch(`${MOCK_VERIFIER_URL}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ borrowerAddress: address }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Verification request failed.");
      await present({
        claims: data.claims,
        validUntil: data.validUntil,
        deadline: data.deadline ?? data.expiry,
        signature: data.signature,
      });
    } catch (err) {
      setErrorMessage(err.shortMessage || err.message || "Something went wrong.");
      setStatus("error");
    }
  }

  const roleWord = role === "lender" ? "lend" : "borrow";

  if (!elig.ready) {
    return (
      <div style={cardStyle}>
        <p style={{ fontSize: 12, color: "var(--parch-dim)", margin: 0 }}>
          The identity registry is not deployed on this network.
        </p>
      </div>
    );
  }

  if (elig.eligible === undefined) {
    return (
      <div style={cardStyle}>
        <p style={{ fontSize: 12, color: "var(--parch-dim)", margin: 0 }}>Checking eligibility…</p>
      </div>
    );
  }

  if (elig.eligible) {
    if (elig.notRequired) return null;
    const issuer = providers.find((p) => p.key.toLowerCase() === (elig.attester || "").toLowerCase());
    return (
      <div style={cardStyle}>
        <p style={{ fontSize: 11, color: "var(--parch-dim)", margin: "0 0 8px" }}>Eligibility</p>
        <p style={{ fontSize: 14, color: "var(--brass)", margin: 0 }}>Eligible to {roleWord}</p>
        <ClaimList claims={elig.claims} required={elig.requiredClaims} />
        <p style={{ fontSize: 12, color: "var(--parch-dim)", margin: "8px 0 0", lineHeight: 1.6 }}>
          {elig.manual ? "Granted by the operator." : issuer ? `Attested by ${issuer.name}.` : ""}{" "}
          Valid until {new Date(elig.validUntil * 1000).toLocaleDateString()}. What is recorded on
          chain is which checks passed, who performed them and until when — not who you are.
        </p>
      </div>
    );
  }

  const busy = status === "requesting" || status === "submitting";
  const canPresent =
    form.signature.trim().length > 0 && Number(form.claims) > 0 &&
    Number(form.validUntil) > 0 && Number(form.deadline) > 0 && !busy;

  return (
    <div style={cardStyle}>
      <p style={{ fontSize: 11, color: "var(--parch-dim)", margin: "0 0 10px" }}>
        {role === "lender" ? "Lending requires a screened wallet" : "Borrowing requires a verified wallet"}
      </p>

      {elig.reason && (
        <p style={{ fontSize: 12, color: "var(--brick)", margin: "0 0 10px", lineHeight: 1.6 }}>{elig.reason}</p>
      )}

      <p style={{ fontSize: 12, color: "var(--parch-dim)", margin: "0 0 6px", lineHeight: 1.6 }}>
        To {roleWord}, this wallet needs an attestation covering:
      </p>
      <ClaimList claims={elig.claims} required={elig.requiredClaims} showMissing />

      <p style={{ fontSize: 12, color: "var(--parch-dim)", margin: "10px 0 6px", lineHeight: 1.6 }}>
        Covenza does not carry out identity checks and never receives your name, documents or any
        other personal data. Get checked by one of the providers below; they give you an attestation
        for this address, which you present here.
      </p>
      <p style={{ fontSize: 12, color: "var(--parch-dim)", margin: "0 0 16px", lineHeight: 1.6 }}>
        What ends up on chain is which checks this wallet passed, which provider performed them, and
        until when — and nothing about who you are.
      </p>

      <p className="mono" style={{ fontSize: 11, color: "var(--parch-dim)", margin: "0 0 16px" }}>
        {address}
      </p>

      {/* --- Where to go --- */}
      <p style={sectionLabel}>Recognised providers</p>

      {loadingProviders && (
        <p style={{ fontSize: 12, color: "var(--parch-dim)", margin: "0 0 14px" }}>Loading…</p>
      )}

      {legacy && (
        <p style={{ fontSize: 12, color: "var(--parch-dim)", margin: "0 0 14px", lineHeight: 1.6 }}>
          The registry deployed here predates recognised providers, so there is no list to show.
          Redeploy the KYC registry to use this.
        </p>
      )}

      {!legacy && !loadingProviders && providers.length === 0 && (
        <p style={{ fontSize: 12, color: "var(--brick)", margin: "0 0 14px", lineHeight: 1.6 }}>
          This deployment recognises no identity providers, so no wallet can be admitted by
          attestation. The operator sets the list.
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 18 }}>
        {providers.map((p) => (
          <div key={p.key} style={rowStyle}>
            <div>
              <p style={{ fontSize: 13, color: "var(--parch)", margin: "0 0 2px" }}>{p.name}</p>
              <p className="mono" style={{ fontSize: 10, color: "var(--parch-dim)", margin: 0 }}>
                {p.key}
              </p>
            </div>
            {p.url ? (
              <a
                href={p.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 12, color: "var(--brass)", whiteSpace: "nowrap" }}
              >
                Get verified →
              </a>
            ) : (
              <span style={{ fontSize: 11, color: "var(--parch-dim)", whiteSpace: "nowrap" }}>
                no link published
              </span>
            )}
          </div>
        ))}
      </div>

      {/* --- Presenting the result --- */}
      <p style={sectionLabel}>Present an attestation</p>
      <p style={{ fontSize: 11, color: "var(--parch-dim)", margin: "0 0 12px", lineHeight: 1.6 }}>
        Paste what your provider gave you — pasting the whole JSON into the signature box fills every
        field. The registry checks it was signed by a recognised provider for this address; one for a
        different wallet, from an unrecognised provider, or past its submission deadline is refused.
        Presenting a fresh attestation renews an expired one.
      </p>

      <label style={labelStyle}>Signature</label>
      <input
        value={form.signature}
        onChange={set("signature")}
        onPaste={onSignaturePaste}
        placeholder="0x… or the provider's JSON"
        style={inputStyle}
        disabled={busy}
      />

      <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Claims</label>
          <input value={form.claims} onChange={set("claims")} placeholder="7" style={inputStyle} disabled={busy} />
        </div>
        <div style={{ flex: 2 }}>
          <label style={labelStyle}>Valid until (unix s)</label>
          <input value={form.validUntil} onChange={set("validUntil")} placeholder="1800000000" style={inputStyle} disabled={busy} />
        </div>
        <div style={{ flex: 2 }}>
          <label style={labelStyle}>Submit by (unix s)</label>
          <input value={form.deadline} onChange={set("deadline")} placeholder="1785640000" style={inputStyle} disabled={busy} />
        </div>
      </div>

      <button
        onClick={() => present({ ...form, signature: form.signature.trim() })}
        disabled={!canPresent}
        style={{
          width: "100%",
          background: canPresent ? "var(--brass)" : "transparent",
          color: canPresent ? "var(--ink)" : "var(--parch-dim)",
          border: canPresent ? "none" : "1px solid var(--hairline)",
          borderRadius: 8,
          padding: 11,
          fontSize: 13,
          fontWeight: 500,
          marginTop: 14,
          cursor: canPresent ? "pointer" : "default",
        }}
      >
        {status === "submitting" ? "Confirming on-chain…" : "Present attestation"}
      </button>

      {/* --- Development stand-in --- */}
      {MOCK_VERIFIER_URL && (
        <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--hairline)" }}>
          <p style={{ fontSize: 11, color: "var(--brick)", margin: "0 0 6px", lineHeight: 1.6 }}>
            Development stand-in — a signer will issue an attestation for all three claims without
            checking anything. No documents are examined and no identity is established.
          </p>
          {/* Named because it is not otherwise visible which service answers,
              and a verifier configured for another chain reports on a registry
              the app is not using. That cost an hour to find. */}
          <p className="mono" style={{ fontSize: 10, color: "var(--parch-dim)", margin: "0 0 8px" }}>
            {MOCK_VERIFIER_URL}
          </p>
          <button
            onClick={useMockProvider}
            disabled={busy}
            style={{
              background: "transparent",
              color: "var(--parch-dim)",
              border: "1px solid var(--hairline)",
              borderRadius: 8,
              padding: "9px 14px",
              fontSize: 12,
              cursor: busy ? "default" : "pointer",
            }}
          >
            {status === "requesting" ? "Requesting…" : "Issue a simulated attestation"}
          </button>
        </div>
      )}

      {errorMessage && (
        <p style={{ fontSize: 12, color: "var(--brick)", marginTop: 12 }}>{errorMessage}</p>
      )}
    </div>
  );
}

/** The claims a role needs, ticked where this wallet's attestation has them. */
function ClaimList({ claims, required, showMissing }) {
  if (required === undefined) return null;
  const bits = [1, 2, 4].filter((b) => required & b);
  return (
    <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0", display: "flex", flexDirection: "column", gap: 4 }}>
      {bits.map((b) => {
        const has = (claims & b) !== 0;
        if (!showMissing && !has) return null;
        return (
          <li key={b} style={{ fontSize: 12, color: has ? "var(--parch)" : "var(--brick)" }}>
            {has ? "✓" : "✗"} {CLAIM_LABELS[b]}
          </li>
        );
      })}
    </ul>
  );
}

const sectionLabel = {
  fontSize: 12,
  fontWeight: 600,
  color: "var(--parch)",
  margin: "0 0 8px",
};

const labelStyle = {
  fontSize: 12,
  color: "var(--parch-dim)",
  display: "block",
  marginBottom: 6,
};

const rowStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  background: "var(--ink)",
  border: "1px solid var(--hairline)",
  borderRadius: 8,
  padding: "10px 12px",
};

const cardStyle = {
  background: "var(--panel)",
  borderRadius: 10,
  border: "1px solid var(--hairline)",
  padding: "18px 20px",
};

const inputStyle = {
  width: "100%",
  background: "var(--ink)",
  border: "1px solid var(--hairline)",
  borderRadius: 8,
  padding: "9px 10px",
  color: "var(--parch)",
  fontSize: 12,
  fontFamily: "IBM Plex Mono, monospace",
};
