# Covenza — web interface

React interface for the [Covenza](https://github.com/jsteele111/covenza-backend) low-collateral lending protocol on Arbitrum.

**Live: [covenza.xyz](https://covenza.xyz)** · [Protocol dashboard](https://covenza.xyz/dashboard) (no wallet required)

Contracts and tests live in the separate [covenza-backend](https://github.com/jsteele111/covenza-backend) repository.

---

## What it does

Four views, gated by the connected wallet's on-chain role.

### `/dashboard` — public, no wallet

The transparency layer. Per-asset insurance reserves, active and all-time principal, the protocol-wide settlement configuration read live from `AssetRegistry`, and the deposit-sizing model's recommendations at 95% and 99% confidence across 7/30/90-day terms.

Deliberately requires no wallet — anyone should be able to assess the protocol's risk buffers before deciding to lend or borrow.

### `/lender` — origination

Asset selection across the whitelist, live KYC verification of the borrower address, and loan terms. The deposit field is backed by the VaR model: a one-click fill applies the recommended percentage for that asset and duration, and the insurance skim owed at origination is disclosed before signing.

Origination is a two-transaction flow — ERC20 approval, then `deployVault` — surfaced as distinct steps rather than a single opaque button.

### `/borrower` — vault operation

Live vault statement, then the permitted actions:

- **Deposit** — approve and pay. Until this completes, every other panel is disabled with an explicit reason, mirroring the contract's own `depositPaid()` gate.
- **Aave** — supply and withdraw, bounded by the investable balance (`vaultBalance − deposit`).
- **Swap** — directional swaps into whitelisted assets with borrower-set slippage floor and pool fee tier.
- **Swap back** — per-held-asset unwind, with a standing note that anything still held is force-swapped at settlement.
- **Settle** — repay and close.

Each action reads its own disabled reason from live contract state, so the UI never offers something the contract would reject.

### `/operator` — protocol governance

Settlement loss history for manual KYC review, the asset whitelist, insurance pool reserves and draw cap, and the protocol-wide settlement configuration — TWAP window and tolerance, swap-back grace period, keeper bounty rate and cap. All five settlement values are submitted atomically, matching the contract's own `setSettlementConfig` signature.

---

## Design notes

**Roles are detected, not selected.** `useWalletRole` reads the connected wallet's actual on-chain relationships — operator of the KYC registry, lender or borrower on any vault. Routes are guarded against direct navigation; a wallet without a role is redirected rather than shown an error. A wallet holding several roles gets a persistent switcher.

**Amounts are formatted from contract-reported decimals**, never assumed. Every vault reads its own `asset()`, then that token's `decimals()`. A USDC vault and a WETH vault render correctly without special-casing.

**Undeployed contracts are stated honestly.** `isPlaceholder()` checks for zero addresses before firing reads, so a network without a deployment shows "not yet deployed" rather than a wall of failed RPC calls.

**ABIs are pre-parsed once** in `config/abis.js` and consumed directly. Re-wrapping an already-parsed ABI in `parseAbi()` throws at module load and takes the whole app down before React renders — a mistake worth only making once.

---

## Running locally

```bash
npm install
cp .env.example .env    # then fill it in
npm run dev
```

Opens on `http://localhost:5173`.

Contract addresses are already configured in `src/config/contracts.js` for Arbitrum Sepolia — no manual editing needed. Update that file only after redeploying the contracts.

### Environment

| Variable | Required | Purpose |
|---|---|---|
| `VITE_WALLETCONNECT_PROJECT_ID` | Optional | WalletConnect / mobile wallets. MetaMask's extension works without it. Free ID at [cloud.reown.com](https://cloud.reown.com). |
| `VITE_ARBITRUM_SEPOLIA_RPC_URL` | Recommended | Falls back to a public RPC, which rate-limits under the dashboard's parallel reads. |
| `VITE_VERIFIER_SERVICE_URL` | Optional | Base URL for the KYC verifier. `http://localhost:4000` locally, `/.netlify/functions` when deployed. |
| `VERIFIER_PRIVATE_KEY` | Server-side | Signs KYC attestations. Set in host environment only — deliberately no `VITE_` prefix, which would expose it in the client bundle. |

Anything prefixed `VITE_` is compiled into the public bundle and readable by anyone. Treat those as configuration, not secrets.

---

## Stack

React 19 · Vite · wagmi v2 · viem · RainbowKit · React Router v7

Deployed on Netlify. `netlify.toml` carries a catch-all rewrite so direct visits to `/dashboard` and the role routes resolve client-side rather than 404ing.

---

## Known limitations

- **KYC intake is simulated.** The form collects no real documents and performs no checks. The signed attestation and resulting on-chain badge are real; the identity verification behind them is not yet.
- **No live price quotes on swaps.** `minAmountOut` is borrower-supplied and enforced on-chain. The UI doesn't estimate it, because there's no on-chain quote function it could source safely — asking directly is more honest than displaying a number it can't stand behind.
- **Vault history is scoped to the current factory.** Vaults deployed by an earlier factory don't appear.
- **Testnet only.** Not deployed against mainnet contracts.