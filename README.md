# Covenza — web interface

React interface for the [Covenza](https://github.com/jsteele111/covenza-backend) fixed-term, low-collateral, non-liquidating lending protocol on Robinhood Chain.

**Live: [covenza.xyz](https://covenza.xyz)** · [Protocol dashboard](https://covenza.xyz/dashboard) (no wallet required)

Contracts and tests live in the separate [covenza-backend](https://github.com/jsteele111/covenza-backend) repository. This interface targets the contracts frozen for audit at tag `audit-freeze-2026-10`; its ABIs in `src/config/abi/` are exported from that build.

---

## What it does

A landing page, a public dashboard, and four views gated by the connected wallet's on-chain role. A sticky header carries the navigation, folding into a menu on a phone; a banner marks the site as testnet.

### `/dashboard` — public, no wallet

The transparency layer. Per-asset insurance reserves, active and all-time principal, the protocol-wide settlement configuration read live from `AssetRegistry`, both limits on an insurance draw, the insurance premium per tier, and the deposit floor each asset's tier enforces at 7, 30 and 90 days — computed on chain, not recommended.

### `/lender` — mandates and origination

Lenders must hold an attestation covering the factory's `requiredLenderClaims` (sanctions screening by default); the page checks this first and guides an unscreened wallet through it.

- **Publish terms (mandates).** A pricing surface over term and deposit, a per-loan maximum and a total capacity across all fills. Capital stays in the lender's wallet; the approval offered is bounded to the total capacity.
- **Originate directly** for a known borrower, with live eligibility of the borrower address, the deposit floor for the chosen risk ceiling and term, and both insurance limits (share of principal, share of reserve) shown before signing.
- **Each vault** carries its actions: settle, settle in kind, cancel an unfunded loan, and claim a payout the token refused at settlement.

### `/borrower` — mandates and vault operation

Borrowers must hold a current attestation covering `requiredBorrowerClaims` (identity, sanctions, jurisdiction by default). A lapsed attestation stops new borrowing but never hides an existing loan.

- **Fill a mandate** — size, term and deposit priced live; the contract's own quote is passed as the most the borrower will pay.
- **Deposit** — approve and pay, for directly originated loans.
- **Swap** — directional swaps into whitelisted assets through the pool the protocol approved for the pair, with the TWAP reference and the vault's acceptance floor from `VaultLens`.
- **Swap back** — bounded by what the vault recorded buying, never filled below the TWAP less the tolerance.
- **Settle / settle in kind / claim** — shared with the lender view.

Swaps and settlements are dry-run (`eth_call`) before signing, so a refusal shows the contract's own reason.

### `/history` — closed loans

Every closed loan the wallet lent or borrowed, newest first, filterable by side, each expanding to its full statement; plus the lender's past mandates. Lend and Borrow show only what is still running. A closed loan that still owes the wallet a payout the token refused is marked here, and Lend and Borrow carry a banner pointing to it.

### `/operator` — protocol governance

Readable by anyone; writes require the operator role. Loss and in-kind settlement history for manual review, verified wallets, recognised identity providers, the asset whitelist and tiers, approved pools (with the price-history check), insurance draw limits and administrative withdrawal, and the settlement configuration.

Every change open vaults read at settlement is timelocked: it is announced by the hash of its exact calldata, waits the delay in public view, and is then executed with identical arguments.

---

## Running locally

```bash
npm install
cp .env.example .env    # then fill it in
npm run dev
```

Opens on `http://localhost:5173`.

To click-test against a local chain with real Uniswap, run the backend's local scripts first (`deploy-local.js` and friends — see the backend's `scripts/README.md`); the app's chain `31337` addresses match a fresh node. Set `VITE_VERIFIER_SERVICE_URL=http://localhost:4000` and run the backend's `mock-verify-server.js` to verify test wallets from the interface.

Contract addresses live in `src/config/contracts.js`, per chain (Robinhood testnet `46630`, local Hardhat `31337`). Until a network's addresses are filled in after a deploy, the app says the protocol is not deployed there rather than showing empty data.

### Environment

| Variable | Required | Purpose |
|---|---|---|
| `VITE_WALLETCONNECT_PROJECT_ID` | Required | RainbowKit refuses to start without one, even for MetaMask alone. Free ID at [cloud.reown.com](https://cloud.reown.com). |
| `VITE_ROBINHOOD_TESTNET_RPC_URL` | Recommended | Falls back to the public endpoint, which drops long-lived connections. |
| `VITE_VERIFIER_SERVICE_URL` | Development only | The backend's local mock attester. Ignored by production builds. |

Anything prefixed `VITE_` is compiled into the public bundle and readable by anyone. Treat those as configuration, not secrets.

---

## Design notes

**Eligibility, not "verified".** Attestations carry claims and expire. The app asks `isEligible(wallet, requiredClaims)` with the claims read from the factory — the same question the factory asks at origination.

**Roles are detected, not selected.** `useWalletRole` reads the connected wallet's on-chain relationships — operator, lender or borrower on any vault. The header shows only the pages that apply: History once a wallet is connected, Operator only to the operator.

**Time comes from the chain.** Countdowns and windows use the latest block's timestamp plus the time since it was seen (`useChainNow`), never the browser clock alone — the two disagreed by days once chain time was moved in testing.

**Dry-runs follow the chain.** Swaps, settlement and publishing are simulated before signing and re-checked on new blocks, so a button disables itself when the chain changes under it (a token frozen, a pool moved).

**No BigInt arrays as props.** React 19's development build serialises changed props and throws on a BigInt inside an array; values are formatted or passed as functions instead.

**Amounts are formatted from contract-reported decimals**, never assumed.

**ABIs are exported, not hand-written.** `config/abis.js` imports the JSON ABIs from the frozen build; only the ERC-20 and Uniswap fragments are parsed from strings.

---

## Stack

React 19 · Vite · wagmi v2 · viem · RainbowKit · React Router v7

Deployed on Netlify as a static site. `netlify.toml` carries a catch-all rewrite so direct visits to `/dashboard` and the role routes resolve client-side.

---

## Known limitations

- **Testnet only**, against test tokens and a Uniswap V3 deployment the project controls.
- **Not yet independently audited.** The contracts are frozen for audit.
- **Vault history is scoped to the current factory.** Vaults deployed by an earlier factory don't appear.
- **In-kind handovers are found from event logs**, read from block 0. On a long chain an RPC with a block-range limit may refuse that read; the claim panel then shows only loan-asset payouts.
