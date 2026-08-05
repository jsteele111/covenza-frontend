# UI/UX test pass — findings

**Started:** 5 August 2026
**Target:** covenza.xyz, deploy `6a727b3c`, Robinhood Chain testnet (46630)
**Method:** every route, every interaction, from the perspective of someone who did not build it.

Findings are logged as found and triaged at the end, so that a fix does not
pre-empt a redesign the later routes might argue for.

**Severity**
- **A** — wrong, misleading, or broken. Fix before showing anyone.
- **B** — works, but teaches the wrong thing or looks unfinished.
- **C** — polish.

---

# RESOLUTION — 5 August 2026

All 23 review items actioned, plus 3 defects found while fixing them. Twenty-five
fixed, one closed by decision, one deferred with reasons. Deployed to covenza.xyz against a fresh stack; 236 tests passing.

## Verified live after the fix

| # | Evidence |
|---|---|
| 13A / 13A(ii) | Preview now reads "30d at 31.0% deposit — 9.60% APR". Was "30d at 15%", a loan the protocol refuses, quoting a rate the lender could never receive |
| 17A | Button reads "Approve 100 tUSDG" — the mandate maximum, not the balance |
| 27A | `/operator` renders for a non-operator wallet; all 28 buttons and 14 inputs confirmed disabled via `:disabled`, banner names the governing Safe |
| 5A / 6A / 7B / 8B | Landing page: both cards are real links, product explained, testnet notice, risk disclosure for both sides |
| 1A / 2A / 3B | Dashboard shows enforced floors — 31.0% Blue chip, 51.6% Standard at 30d, matching the registry — with a testnet-values banner and the stale model footnote gone |
| 11B | "Verified — you can borrow", correctly omitting an attester for a wallet verified by operator override |

## Verified live by a full loan cycle

Mandate published, filled at 50 tUSDG over 1 day, and a 1 tUSDG swap into tWETH
executed. All six confirmed on chain:

- **20B** card is a real `<button>`, focusable, with `aria-expanded`
- **18C** "Published — it is live below" appears at the point of action
- **26B** both rows present: "if settled now" and "if held to deadline"
- **25B** "test venue, not a real yield source" beside the ERC-4626 panel
- **23B** tAAPL struck through and unclickable, with the ceiling explained
- **24B** "TWAP 0.9918 · use 0.9819" — 0.9918 × 0.99 exactly, the entry-impact
  allowance. A swap at that figure was accepted and executed.

## Found by running it — three new defects

### 29A — "Published" was announced after an approval

The success flag was set on `isSuccess` alone, and approving and publishing
share one `useWriteContract`. Approving 100 tUSDG produced "Published — it is
live below and borrowers can fill it now" with no mandate in existence.

Confirming something that did not happen is worse than the silence it replaced:
the lender goes looking for a mandate that was never written. Now keyed on which
action was in flight. **Fixed and verified.**

### 30B — Pool-depth refusals surface Uniswap's wording, not ours

A 10 tUSDG swap at the quoted floor is refused with "Too little received" —
Uniswap's router error. The real cause is that a trade that size cannot achieve
the vault's entry-impact threshold in this pool, which Covenza has its own
sentence for: "Position too large for this pool's depth".

The borrower is told the trade failed, not that it was too big, and nothing
suggests the two remedies: a smaller amount, or a different fee tier. A 1 tUSDG
swap at the same tier succeeded.

**Fixed.** `explainSwapRefusal()` distinguishes the two cases: if the borrower's
minimum is at or below what the vault itself would accept, no minimum they could
set would help, so the message names the real cause and both remedies — a
smaller amount or a different fee tier. Otherwise it points at the vault's floor
as the figure to use.

### 31C — Minimum output goes stale when the amount changes

Changing the swap amount leaves the previously-inserted minimum output in place,
so a figure quoted for 10 tUSDG persists against a 1 tUSDG trade and the form
reports a refusal that is an artefact of the stale value.

**Fixed.** The minimum clears whenever the amount, destination asset or fee tier
changes — it is only meaningful against the trade it was quoted for.

## Closed by decision, not fixed

- **4B** the "Wrong network" badge is RainbowKit's and is telling the truth.
  Both public pages now state the network expectation, which was the underlying
  confusion.

## Found while fixing

Three defects that the review itself did not catch:

1. **The KYC gate was unreachable by anyone who needed it.** `/borrower`
   required the borrower role, which required being verified — so the screen
   that exists to help an unverified wallet get verified could only be seen by
   wallets that already were. The landing card said "Get verified to borrow",
   the one thing that could not be done. Same bootstrap trap fixed for lenders
   weeks earlier and left open here; invisible during the walkthrough because
   our test borrower was already verified.

2. **The deploy script destroyed the Safe addresses.** It rewrote its network's
   whole object in `deployed-addresses.json`, discarding `operatorSafe` and
   `ownerSafe`. The Safes existed on chain; the record did not, so the handover
   script reported them missing and would have had someone create a second
   pair. Now merges.

3. **The operator tab returned early for non-operators**, beneath the route
   guard — so opening the route was necessary but not sufficient. Refusing to
   show public information to everyone is not a security property.

## Still open, carried forward

- Add real co-signers to both Safes and raise the threshold above 1.
- Decide whether the insurance draw cap should be two numbers.
- Replace placeholder tier volatilities with measured values.
- Make the KYC badge genuinely non-transferable, or stop calling it soulbound.
- Independent audit.

---

# ACTION LIST

Every item needing work, in the order I would do it. Detail for each is in the
route sections below.

## Blocking — fix before this is shown to anyone

| # | Item | Where |
|---|---|---|
| 27A | Operator interface is unreachable by any wallet since the Safe handover | `/operator` |
| 17A | "Raise allowance" grants an unlimited approval without saying so | `/lender` |
| 13A | Pricing preview quotes a deposit the protocol refuses… | `/lender` |
| 13A(ii) | …and consequently overstates the lender's yield by 160 bps at 30d | `/lender` |
| 5A | Landing page calls to action are dead; no route in before connecting | `/` |
| 6A | Landing page never says what Covenza is, or that it is low-collateral | `/` |
| 1A | Recommended-deposit panel empty for every asset — rebuild on the on-chain tier floor | `/dashboard` |
| 2A | Footnote cites the superseded v1.1 deposit model | `/dashboard` |

## Should fix before wider testing

| # | Item | Where |
|---|---|---|
| 23B | Tier refusal hidden behind unrelated validation; mark the asset unavailable instead | `/borrower` |
| 26B | "Lender receives (at settlement)" means "if settled now" — relabel, show both | `/borrower` |
| 25B | Yield venue not identified as a mock | `/borrower` |
| 24B | No price reference for setting minimum output | `/borrower` |
| 16B | Raise allowance has no in-flight state, though Publish mandate does | `/lender` |
| 11B | A verified borrower is never told they are verified | `/borrower` |
| 20B | Mandate card is not a button — not keyboard reachable, so cannot borrow | `/borrower` |
| 10B / 28B | Guarded routes redirect silently, and `/operator` lands on another role's page | routing |
| 3B | Testnet parameters presented as protocol parameters | `/dashboard` |
| 7B | Nothing indicates this is a testnet | `/` |
| 8B | No risk disclosure on any public surface (BRD REG-4 requires it) | `/`, `/dashboard` |
| 4B | Red "Wrong network" alarm on pages that need no wallet | `/dashboard`, `/` |

## Polish

| # | Item | Where |
|---|---|---|
| 18C | Publishing succeeds silently; confirmation is below the fold | `/lender` |
| 9C | Landing page content occupies the top fifth of the viewport | `/` |

## Decisions needed from you, not fixes

1. **Should the deposit credit be measured from the lender's minimum or from the
   protocol floor?** Currently a borrower is rewarded for deposit the protocol
   forced them to post. Pricing design, not a defect. (13A(ii))
2. **How should the operator reach the interface?** Safe via WalletConnect,
   open the reads to everyone, or accept scripts as the operator path. (27A)
3. **Bounded or unlimited approval by default**, and what the button should say.
   (17A)
4. **What the landing page should be.** Fixing the dead links is trivial; what
   the page should actually say about the product is yours. (5A, 6A)

## What was verified working

Recorded because a defect list alone misrepresents the state of the build.

- Full lifecycle end to end: allowance → publish mandate → fill atomically →
  active vault, on the live deployment.
- Deposit floor enforced and explained at the point of refusal, with correct
  arithmetic (15.48 tUSDG = 30.96% of 50).
- Tier ceiling refused pre-flight using the contract's own wording.
- Interest maths exact: 0.3247 tUSDG = 50 × 7.9% × 30/365, with the minimum
  charge correctly applying on a minutes-old loan.
- `fillable` correctly reported as the mandate maximum, not the allowance behind
  it.
- Mandate expiry counting down; two-step approve-then-fill clearly labelled.
- No console errors on any route.

---

## `/dashboard` — public protocol dashboard

Loads correctly against the current stack. No console errors. The 2,000 tUSDG
reserve and all three assets confirm it is reading today's deployment.

### 1A — The recommended-deposit panel is empty for every asset

The section offers 7d / 30d / 90d toggles under "Recommended minimum deposit
for", then prints "No deposit-sizing data published for this asset yet" three
times. `src/config/depositModel.json` still holds ETH, WBTC, USDC and USDT —
the Arbitrum Sepolia cohort. None of the deployed assets appear.

The page advertises a capability and delivers nothing, which is worse than not
offering it.

**Decision taken:** rebuild the panel on `minimumDepositBpsForTier` read from
the asset registry, rather than repopulating the JSON. The deposit floor is now
computed on chain and *enforced* — an off-chain recommendation is no longer
what governs, and inventing volatilities for test tokens would drift from the
contract again within a week.

### 2A — Footnote cites a superseded model

"Deposit model v1.1, dated 2026-07-23 … computed from CoinGecko daily closes"
— v2 supersedes it, and v1.1's asset cohort is not the deployed universe.
Resolved by 1A if the panel stops reading the JSON at all.

### 3B — Testnet parameters presented as protocol parameters

The page is headed "the same figures underwriting every vault, visible to
anyone before they lend or borrow", then shows a 1-minute TWAP window, a
0.025-hour grace period and a 30%/hr keeper bounty. Every one of those is
demo-tuned so the paths are reachable in a single sitting.

A reader has no way to distinguish a deliberate protocol parameter from a value
chosen to make a demo run quickly. Needs either a testnet banner or per-value
qualification.

### 4B — "Wrong network" alarm on a page that needs no wallet

The dashboard is public, read-only, and rendered correctly. A red **Wrong
network** badge sits in the header regardless. It is accurate — the connected
wallet is on another chain — but a public page opening with a red alert reads
as broken rather than as informational.

Consider suppressing or softening it on routes that do not require a wallet.

---

## `/` — visitor landing

### 5A — The two calls to action are dead

"Become a lender" and "Get verified to borrow" are the page's only primary
actions and neither is a link. `InfoCard` renders a plain `div`; `read_page`
finds only the Dashboard link and the chain selector. This is unconditional —
not a wrong-network state, not a missing-wallet state.

**CORRECTED after connecting a wallet.** My first reading of this was too
strong. Once a wallet is connected a Lender / Borrower switcher appears above
the cards, so navigation does exist. The accurate statement is narrower:

- **Before connecting**, there is no route to `/lender` or `/borrower` at all.
  The cards look like the two primary calls to action and do nothing, and the
  switcher is not yet rendered. Typing `/borrower` directly bounces back to `/`
  (see 10B), so an unconnected visitor is returned to a page offering them
  nowhere to go.
- **After connecting**, the switcher works and the cards are merely inert
  decoration that still looks clickable.

Severity stays at A for the unconnected case and drops to C for the connected
one. Recording the correction rather than quietly restating it, because the
first version of this finding would have sent someone looking for a routing bug
that is not there.

The component comment explains the intent: neither path should be *redirected*
into automatically, since a role is only assumed once detected on chain. That
reasoning is right. It appears to have been implemented as "do not link either",
which is a different thing.

This is the bootstrap trap again, in a new place. It was fixed in role detection
— lending is permissionless, so the lender view must always be reachable — and
the landing page still cannot get anyone there.

### 6A — The page never says what Covenza is

A first-time visitor sees two cards and a dashboard link. There is no headline,
no description of the product, and no statement of the thing the BRD treats as
foundational: that this is **low-collateral, not uncollateralised**, and
**non-liquidating**.

Guiding principle one in the BRD is "honesty of label". The landing page makes
no label at all. Someone arriving from a link has no way to learn what this is
without connecting a wallet and exploring.

### 7B — Nothing indicates this is a testnet

No banner, no chip, no mention. The assets are named tUSDG, tWETH and tAAPL,
which is a hint rather than a statement. A visitor could reasonably believe this
is a live product holding real money.

### 8B — No risk disclosure anywhere in the public surface

REG-4 in the BRD requires that materials "disclose the risk of loss to both
borrowers (deposit at risk) and lenders (residual risk beyond deposit and
insurance pool coverage)". Neither the landing page nor the dashboard says
anything about risk of loss.

The lender form now discloses the insurance cap, which is good — but that is
behind a wallet connection and a route nobody can reach from the front page.

### 10B — Guarded routes redirect silently

With no wallet connected, navigating to `/borrower` returns you to `/` with no
message. The redirect is correct — the route needs a wallet — but the user is
given no reason, and lands on a page that (unconnected) offers no way forward.

A visitor who follows a shared link to `/borrower` experiences this as the link
being broken.

### 9C — Vertical space

Content occupies roughly the top fifth of the viewport, with the rest empty.
Reads as an unfinished page rather than a deliberately spare one.

---

## `/borrower` — connected as the verified borrower `0x6369…D576D`

The verification gate correctly does not appear for a verified wallet; the page
goes straight to the mandate board. The role switcher renders. No console
errors.

### 11B — A verified borrower is never told they are verified

The entire page is the mandate board. There is no badge, no status line, no
confirmation anywhere that this wallet has passed verification.

Two people are poorly served by this. Someone who has just been verified gets no
acknowledgement that it worked. Someone who is unsure of their status has no way
to check it — the only signal is the *absence* of the gate, which requires
knowing the gate exists.

The KYC badge NFT exists and is readable. Surfacing verification status, which
attester admitted the wallet, and when, would cost little and is exactly the
information the attester model makes auditable.

### 12 — Positive: the empty state explains itself

"No live mandates. A lender publishes terms they will accept; once one exists it
appears here and can be filled in a single transaction." This teaches the
mechanism rather than just reporting emptiness. Worth keeping as the pattern for
other empty states.

### Blocked — the borrower flow cannot be tested yet

No mandates exist, because the stack was redeployed today and mandates do not
survive a redeploy. Testing the fill path, the deposit floor warning, the tier
ceiling and the swap refusals all requires a live mandate first.

**Sequence:** publish a mandate as the lender, then return here as the borrower.

---

## `/borrower` — filling a mandate

### 20B — The mandate card is not a button

The card expands into the fill form on click, but it is a plain element with an
`onClick`. `read_page` with an interactive filter does not see it: no role, no
tab stop, no focus state, no keyboard activation.

A keyboard user cannot open a mandate, which means they cannot borrow. It also
gives no hover or focus affordance, so it is not obvious the card does anything
until you try.

### 21 — Positive: the deposit floor is enforced and explained at the point of failure

Entering 50 tUSDG over 30 days at the mandate's advertised 15% deposit:

- the action is disabled rather than left to fail on chain,
- the reason is stated plainly — "A 30-day loan at this risk tier requires a
  31.0% deposit",
- both figures are shown: 7.5 tUSDG posted against 15.48 tUSDG required,
- 15.48 is 30.96% of 50, which is exactly right.

This is the standard the rest of the interface should meet: refuse early, say
why, and show the arithmetic. It is also the direct evidence that finding 13A is
a one-panel inconsistency rather than a missing capability.

### 23B — The tier refusal is hidden behind unrelated validation

Selecting tAAPL as a swap destination on a Blue chip vault is never going to
work — tAAPL is Standard, and no amount or price will change that. But the form
reports its objections in the wrong order:

1. Select tAAPL, enter 10 tUSDG → "Enter a minimum output amount."
2. Enter a minimum output → "Asset exceeds this vault's risk mandate."

The borrower is asked to fix a solvable problem before being told about the
unsolvable one. The ceiling is a property of the asset and the vault alone; it
is knowable the instant tAAPL is selected, before any amount is typed.

Worth saying that the check itself is good — it uses the contract's own wording,
which means a borrower who hits the same wall on chain reads the same sentence.
Only the ordering is wrong.

Better still: mark tAAPL as unavailable in the destination selector for this
vault, with the reason, rather than letting it be selected at all.

### 24B — No price reference for the minimum output

"Minimum output is your own slippage protection, enforced on-chain — there's no
live price quote wired into this form, so set it deliberately."

Honest, and the honesty is worth keeping. But a borrower has no price to be
deliberate *with*. In practice they will either guess, or set a value low enough
to be no protection at all — which defeats the control the sentence is
explaining.

The TWAP is already read on chain for the entry-impact check. Showing it here,
with a "10% below TWAP" style helper, would let the borrower set a number that
means something.

### 25B — The yield venue is not identified as a mock

The panel reads "Yield — ERC-4626 vault · Investable now: 50 tUSDG" with no
qualification. On this deployment that venue is `MockERC4626`, and the project's
own documentation says real funds must never touch it. The production deploy
guard refuses to ship with any venue configured, precisely because this is
dangerous.

The interface should say what the contract knows: this is a test venue.

### 26B — "Lender receives (at settlement)" is ambiguous

The vault statement shows:

- Interest accrued — 0.05 tUSDG
- Interest at full term — 0.3247 tUSDG
- **Lender receives (at settlement) — 50.05 tUSDG**

50.05 is principal plus interest accrued *right now*, i.e. what the lender gets
if the loan settled this second. Held to the deadline they receive 50.3247.

"At settlement" reads as "at the end", which is the one thing it does not mean.
Label it "if settled now", and consider showing both figures — the borrower's
early-close decision turns on exactly that difference.

(The 0.05 is the minimum charge applying, which is correct: pro-rata on a
minutes-old loan would be a fraction of a cent.)

### 22 — Positive: atomicity is stated where it matters

---

## `/operator`

### 27A — The operator interface now has no possible user

Navigating to `/operator` silently redirects to `/lender`. Correct for this
wallet — it is not the operator.

But the operator is now the Safe at `0x0A2e01…5B1c`, and **a Safe cannot browse
a website**. It has no private key and no wallet session. Since the handover
this afternoon, there is no address that can both connect to the site and pass
the operator check:

- the deploying key can connect, but no longer holds the role;
- the Safe holds the role, but cannot connect.

The operator interface — asset listing, tier configuration, the attester panel,
pool administration — is currently unreachable by anyone, for reading as well as
writing.

This was foreseeable and I flagged the write path before we started; I did not
anticipate that the guard would also make the route unreadable, which turns an
inconvenience into a dead feature.

**Three ways out, and they are not exclusive:**

1. **Connect the Safe via WalletConnect.** Safe's own interface can act as a
   WalletConnect wallet, so the Safe address can be the connected account and
   transactions go into its queue for signing. This is the intended pattern for
   multisig-governed dapps and probably the right answer. Untested here.
2. **Make the operator route readable by anyone.** None of it is secret — assets,
   tiers, attesters and pool configuration are all public on chain, and the
   public dashboard already shows some of it. Gate only the write actions.
   This has independent merit: an operator should be able to check state without
   unlocking a multisig.
3. **Accept scripts as the operator path** and remove the route. Honest, but it
   discards working UI and makes curation a developer task permanently.

My suggestion is 2 immediately — it is a small change and it makes the route
useful again today — with 1 as the real answer for write actions.

### 28B — Redirects still silent, and now they cross roles

Same pattern as 10B, and slightly worse here: `/operator` does not just bounce
you home, it lands you on `/lender`, a different role's page, with no
explanation. A person who typed `/operator` has no way to know whether the route
does not exist, is not permitted, or is broken.

"Filling moves everything in one transaction — the lender's principal, your
deposit and the insurance premium. Either all of it settles or none of it does."
Said at the moment of commitment, in plain terms.

---

## `/lender` — connected as the deployer `0x6C93…3a68`

Much the strongest route so far. The lending-capacity panel correctly reports
`0 tUSDG` with an explanation and a Raise allowance action — the `fillable`
concept surfaced honestly rather than advertising a maximum the lender cannot
cover. The deposit-floor notice reads live tier data and its figures check out
exactly against the model: Blue chip floor 10.0% at 1d (the absolute floor
binding) and 31.0% at 30d (1.8 × 0.6 × √(30/365) = 30.96%).

### 13A — The pricing preview quotes a loan the protocol would refuse

"What a borrower would pay" shows three points:

| Row | Quoted |
|---|---|
| 1d at 15% deposit | 9.02% APR |
| **30d at 15% deposit** | **9.60% APR** |
| 30d at 35% deposit | 7.60% APR |

All three are arithmetically correct against the formula (9% base, 2 bps per day
of term, 10 bps credit per point of deposit above the minimum).

**The middle row cannot exist.** The same screen, four lines above, states that
the Blue chip floor is 31.0% at 30 days. A borrower cannot take a 30-day loan at
a 15% deposit — the contract refuses it. The preview prices it anyway, and it is
the row rendered in bold as the headline case.

Two panels on one screen disagree: one explains that the protocol floor
overrides the lender's minimum, the other quotes as though it does not.

**Fix:** the preview should evaluate at `max(lenderMinimum, protocolFloor)` for
each term, which for this configuration would quote 30d at 31% rather than 15%.
That also makes the notice above self-evidently true rather than something the
reader has to reconcile.

Worth noting *why* this survived: the preview is right about pricing and the
notice is right about floors. Each panel is correct in isolation, and neither
consults the other.

**Confirmed from the borrower side, and the fix is smaller than it looked.** The
borrower's fill form handles this correctly: at 50 tUSDG over 30 days with a 15%
deposit it disables the action and states "A 30-day loan at this risk tier
requires a 31.0% deposit", showing 15.48 tUSDG required against 7.5 posted
(30.96% of 50 — exact).

So the floor-aware quoting logic already exists and is already correct. The
lender preview simply does not use it. This is not a new feature; it is one
panel adopting a calculation its neighbour already performs.

### 13A(ii) — The lender's headline rate overstates their actual yield

This is the part that is not cosmetic.

The mandate prices a *credit* for deposit above the lender's stated minimum — 10
bps of APR per point. The protocol floor then forces the deposit up, and the
formula duly pays the borrower a discount for a deposit they had no choice about.

Worked, on the mandate published today (9% base, 2 bps/day, 10 bps credit, 15%
minimum, Blue chip, 30 days):

| | Deposit | APR |
|---|---|---|
| Lender preview claims | 15% | **9.60%** |
| Lowest deposit the protocol permits | 31% | **8.00%** |
| Observed live at 32% | 32% | 7.90% |

**At 30 days the lender's own headline figure overstates their yield by 160
basis points**, and there is no term at which the advertised 9.60% is
achievable. The lender is quoting a rate nobody can ever pay them.

The credit is calculated from the *advertised* minimum rather than from the
*binding* one, so every point by which the floor exceeds the lender's minimum is
a point of yield given away automatically. The wider that gap, the worse it gets
— and the gap grows with the square root of term.

Two things to decide, and only the first is a bug:

1. The preview must quote at the binding deposit. Non-negotiable — it is
   currently telling lenders something untrue about their own economics.
2. Whether the deposit credit should be measured from the lender's minimum or
   from the protocol floor. Measuring from the floor would mean a borrower is
   rewarded only for deposit they chose to add. That is a pricing design
   decision, not a defect, but it should be a decision rather than an accident.

### 16B — No in-flight feedback on Raise allowance

Clicking Raise allowance disables the button, but its label stays "Raise
allowance", with no spinner, no "Approving…", and no status text anywhere on the
panel. Lending capacity continues to read `0 tUSDG`.

From the page alone there is no way to distinguish:

- a wallet prompt waiting off-screen,
- a transaction submitted and pending,
- a request that silently failed to reach the wallet at all.

A disabled control with an unchanged label is the weakest possible signal — it
looks like the button simply stopped working. Every action that raises a
transaction needs a pending state that says so, and a failure state that says
that instead.

This matters more here than elsewhere because the wallet prompt renders outside
the page, so the page is the only place the user can look for reassurance
without hunting for the extension.

**Sharpened after seeing Publish mandate.** That button *does* show
"Confirming…" while in flight. So the pattern exists and is used elsewhere on
the same screen — Raise allowance simply does not use it. This is an
inconsistency between two controls in one panel, not a missing capability, which
makes it a small fix rather than a design question.

### 17A — "Raise allowance" grants an unlimited approval, and does not say so

`MandatePanel.approveAll()` calls `approve(vaultFactory, maxUint256)`.

The button is labelled **Raise allowance**. The panel above it reads "Your
capital stays in your wallet — only an allowance is granted, and a fill draws on
it." Both are true and neither conveys what actually happened: the lender has
approved their **entire balance, without limit and without expiry**, to the
VaultFactory.

Observed live: publishing a mandate with a 100 tUSDG maximum resulted in a
lending capacity of 637,683.19 tUSDG — the whole balance. The capacity line then
explains itself accurately ("the lesser of your balance and your allowance"),
but by then the approval is granted, and it reads as a capability rather than as
an exposure.

The internal function name is `approveAll`, so the behaviour was deliberate. The
gap is entirely in what the interface tells the lender.

**Why this is severity A rather than a wording nit.** An unlimited approval to
the factory is the largest single risk a lender takes in this product, and it is
larger than the loan they think they are making. It also interacts with two
things already on the record:

- `setRegistries` can repoint the factory's registries. It is timelocked, which
  makes an attempt visible, but the allowance is standing the whole time.
- Both governance Safes are currently 1-of-1, owned by the deploying key.

A lender lending 100 tUSDG has not accepted 100 tUSDG of counterparty risk; they
have accepted their balance. That should be their informed decision.

**Options, in increasing order of cost:**

1. State it plainly on the button and in a confirmation — "Approve unlimited
   tUSDG to the factory" — and explain why unlimited is offered (one approval
   serves every future mandate).
2. Offer a bounded approval sized to the mandate's maximum, with unlimited as an
   explicit opt-in for lenders who publish repeatedly.
3. Show the standing allowance somewhere persistent, with a one-click revoke.
   Most wallets can do this, but the lender has to know to go looking.

My suggestion is 2 with 1's wording, defaulting to the bounded amount. The
convenience unlimited buys is real but it is the lender's convenience to trade,
not ours.

### 18C — Publishing succeeds silently, and the confirmation is below the fold

After the transaction confirms, the button reverts from "Confirming…" to
"Publish mandate" and nothing else on the visible screen changes. The form does
not reset and no success message appears.

The mandate *is* published, and it does appear — under "Your mandates", below
the fold, requiring a scroll to see. A lender who does not scroll has the same
evidence of success as of failure: a button that went back to normal.

Either scroll the new mandate into view, or confirm at the point of action.

### 19 — Positive: fillable is computed correctly

The published mandate reports "fillable now: 100 tUSDG" — the mandate's maximum,
not the 637,683 tUSDG allowance behind it. The lesser of allowance, balance and
remaining offer, as designed. Worth recording because it is the number a
borrower will act on.

### 14 — Positive: the pricing rationale is well argued

"A formula, not a range. Publishing a range would mean publishing your worst
terms — every borrower takes the longest term on the smallest deposit. Here both
are priced, so you are indifferent across the whole surface."

This explains a non-obvious design decision in two sentences, at the point where
the lender is making it. Good.

### 15 — Positive: capacity is reported as what a borrower will actually see

"Below the maximum size below — borrowers will only see what you can actually
cover." Correct, and it pre-empts the most likely lender confusion — publishing
a 100 tUSDG maximum and wondering why nobody can fill it.
