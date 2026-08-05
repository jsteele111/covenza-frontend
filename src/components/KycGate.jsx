import { useState } from "react";
import { useChainId, useReadContract, useWriteContract, usePublicClient } from "wagmi";
import { KYC_REGISTRY_ABI } from "../config/abis.js";
import { getContractsForChain } from "../config/contracts.js";
import { useAttesters } from "../hooks/useAttesters.js";

const kycAbi = KYC_REGISTRY_ABI;

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
 * The borrowing gate.
 *
 * Covenza performs no identity check, issues no attestation, and collects no
 * personal data. It reads evidence that a recognised provider produced
 * independently. That is the whole of the design, and this screen exists to
 * make it legible: an earlier version asked for name, email and jurisdiction
 * and then discarded them, which taught exactly the opposite — that the
 * protocol takes custody of identity.
 */
export function KycGate({ address }) {
  const chainId = useChainId();
  const contracts = getContractsForChain(chainId);
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const { live: providers, legacy, isLoading: loadingProviders } = useAttesters();

  const [signature, setSignature] = useState("");
  const [expiry, setExpiry] = useState("");
  const [status, setStatus] = useState("idle");
  const [errorMessage, setErrorMessage] = useState(null);

  const { data: isVerified, refetch: refetchVerified } = useReadContract({
    address: contracts.kycRegistry,
    abi: kycAbi,
    functionName: "isVerified",
    args: [address],
    query: { enabled: !!address },
  });

  const { data: attester } = useReadContract({
    address: contracts.kycRegistry,
    abi: kycAbi,
    functionName: "attestedBy",
    args: [address],
    query: { enabled: !!address && !!isVerified },
  });

  async function present(sig, exp) {
    setErrorMessage(null);
    setStatus("submitting");
    try {
      const fees = await publicClient.estimateFeesPerGas();
      const hash = await writeContractAsync({
        address: contracts.kycRegistry,
        abi: kycAbi,
        functionName: "verifyWithSignature",
        args: [address, BigInt(exp), sig],
        maxFeePerGas: fees.maxFeePerGas * 2n,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      await refetchVerified();
      setStatus("idle");
      setSignature("");
      setExpiry("");
    } catch (err) {
      setErrorMessage(err.shortMessage || err.message || "Something went wrong.");
      setStatus("error");
    }
  }

  // Testnet only: fetches an attestation from the local mock signer, then
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
      await present(data.signature, data.expiry);
    } catch (err) {
      setErrorMessage(err.shortMessage || err.message || "Something went wrong.");
      setStatus("error");
    }
  }

  if (isVerified) {
    const issuer = providers.find(
      (p) => p.key.toLowerCase() === (attester || "").toLowerCase()
    );
    return (
      <div style={cardStyle}>
        <p style={{ fontSize: 11, color: "var(--parch-dim)", margin: "0 0 8px" }}>KYC status</p>
        <p style={{ fontSize: 14, color: "var(--brass)", margin: 0 }}>Verified</p>
        <p style={{ fontSize: 12, color: "var(--parch-dim)", margin: "8px 0 0", lineHeight: 1.6 }}>
          This wallet can borrow.{issuer ? ` Attested by ${issuer.name}.` : ""} What is recorded on
          chain is that a check happened and who performed it — not who you are.
        </p>
      </div>
    );
  }

  const busy = status === "requesting" || status === "submitting";
  const canPresent = signature.trim().length > 0 && Number(expiry) > 0 && !busy;

  return (
    <div style={cardStyle}>
      <p style={{ fontSize: 11, color: "var(--parch-dim)", margin: "0 0 10px" }}>
        Borrowing requires a verified wallet
      </p>

      <p style={{ fontSize: 12, color: "var(--parch-dim)", margin: "0 0 6px", lineHeight: 1.6 }}>
        Covenza does not carry out identity checks and never receives your name, documents or any
        other personal data. Get checked by one of the providers below; they give you an attestation
        for this address, which you present here.
      </p>
      <p style={{ fontSize: 12, color: "var(--parch-dim)", margin: "0 0 16px", lineHeight: 1.6 }}>
        What ends up on chain is a record that this wallet passed a check, which attester
        performed it, and when — and nothing about who you are.
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
          The registry deployed here predates recognised providers — it still trusts a single
          signing key, so there is no list to show. Redeploy the KYC registry to use this.
        </p>
      )}

      {!legacy && !loadingProviders && providers.length === 0 && (
        <p style={{ fontSize: 12, color: "var(--brick)", margin: "0 0 14px", lineHeight: 1.6 }}>
          This deployment recognises no identity providers, so no wallet can be verified. The
          operator sets the list; until one is added, borrowing is closed.
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
        Paste what your provider gave you. The registry checks it was signed by a recognised
        provider and covers this address; an attestation for a different wallet, or from a provider
        that is not recognised, is refused.
      </p>

      <label style={labelStyle}>Signature</label>
      <input
        value={signature}
        onChange={(e) => setSignature(e.target.value)}
        placeholder="0x…"
        style={inputStyle}
        disabled={busy}
      />

      <label style={{ ...labelStyle, marginTop: 10 }}>Expiry (unix seconds)</label>
      <input
        value={expiry}
        onChange={(e) => setExpiry(e.target.value)}
        placeholder="1785640000"
        style={inputStyle}
        disabled={busy}
      />

      <button
        onClick={() => present(signature.trim(), expiry)}
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

      {/* --- Testnet stand-in --- */}
      {MOCK_VERIFIER_URL && (
        <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--hairline)" }}>
          <p style={{ fontSize: 11, color: "var(--brick)", margin: "0 0 6px", lineHeight: 1.6 }}>
            Testnet stand-in — a signer will issue an attestation without checking anything. No
            documents are examined and no identity is established. Present in place of a real
            provider so the borrowing flow can be exercised.
          </p>
          {/* Named because it is not otherwise visible which service answers,
              and the two differ in the only way that matters: a verifier
              configured for another chain will report on a registry the app is
              not using, and refuse a wallet as already verified when it is
              not. That cost an hour to find. */}
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
