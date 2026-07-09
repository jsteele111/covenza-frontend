# Covenza — demo front-end

A minimal Lender/Borrower interface for the Covenza lending protocol on Arbitrum Sepolia.

## Setup

1. Unzip this folder somewhere on your machine (separate from your `lending-poc` backend repo — this is its own project).

2. Install dependencies:
   ```
   npm install
   ```

3. Copy the example env file and fill it in:
   ```
   copy .env.example .env
   ```
   - `VITE_WALLETCONNECT_PROJECT_ID` — get a free one at https://cloud.reown.com. Only needed for WalletConnect/mobile wallets; MetaMask's browser extension works without it.
   - `VITE_ARBITRUM_SEPOLIA_RPC_URL` — optional, your Alchemy RPC URL (same one from your backend's `.env`). Leave blank to use a public fallback.

4. **Edit `src/config/contracts.js`** and paste in your current `KYCRegistry` and `VaultFactory` addresses from your backend's `deployed-addresses.json` (the `arbitrumSepolia` section). You'll need to update this file every time you rerun `deploy-infrastructure.js`, exactly like you already do for the backend scripts.

5. Run it:
   ```
   npm run dev
   ```
   Open the local URL it prints (usually `http://localhost:5173`).

## Using the demo

- **Lender tab**: connect your lender wallet, enter a KYC-verified borrower address and loan terms, click "Originate vault."
- **Borrower tab**: connect your borrower wallet to see the vault's live status (principal, deposit, deadline, Aave position) and act on it — pay deposit, supply to Aave, repay, or settle if expired.
- Switch which wallet is connected in MetaMask to move between roles, same as you've been doing with the backend scripts.

## Known limitations (by design, for this PoC stage)

- No input validation on the lender's loan-terms form — entering something that isn't a valid number will cause an error rather than a friendly message.
- Once a vault is settled, the status seal shows a generic "Settled" state rather than distinguishing repaid vs. defaulted — that distinction currently only lives in past event logs, not live contract state.
- No support for viewing more than the most recent vault per wallet — if a wallet has originated or borrowed multiple vaults, only the latest one shows.
- Assumes the connected wallet's role (lender/borrower) is already KYC-verified where relevant — the app doesn't walk through a KYC flow itself, since that's operator-controlled today.
