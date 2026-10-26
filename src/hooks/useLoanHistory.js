import { useChainId, useReadContract, useReadContracts } from "wagmi";
import { VAULT_ABI, VAULT_FACTORY_ABI, ASSET_REGISTRY_ABI } from "../config/abis.js";
import { getContractsForChain, isPlaceholder, symbolForToken, TOKEN_DECIMALS } from "../config/contracts.js";
import { formatTokenAmount } from "../utils/format.js";
import { SEVERITY_LABELS } from "./useVaultData.js";

const FIELDS = [
  "isSettled", "asset", "lender", "borrower", "principal", "deposit", "aprBps", "term",
  "originatedAt", "deadline", "depositPaid", "lossSeverity", "settledInKind",
  "settledTotalReturned", "settledLenderPayout", "settledBorrowerPayout", "settledFee",
  "settledInsuranceDraw",
];

/**
 * Every loan the wallet has been party to — as lender, as borrower, or both —
 * with what is still owed to it.
 *
 * Feeds the History page, and the "something is waiting to be claimed" banner
 * on the Lend and Borrow pages: settled loans leave those pages, so a payout
 * the token refused at settlement (owed()) must not leave with them.
 *
 * @dev owed() is read for every whitelisted token, not just the loan asset:
 *      an in-kind settlement can leave a held token owed too, and the vault no
 *      longer lists what it held once settled. The whitelist is a handful of
 *      tokens, so this is a small fixed number of reads per settled loan.
 */
export function useLoanHistory(wallet) {
  const chainId = useChainId();
  const contracts = getContractsForChain(chainId);
  const ready = Boolean(wallet) && !isPlaceholder(contracts.vaultFactory);

  const { data: lists, refetch: refetchLists } = useReadContracts({
    contracts: [
      { address: contracts.vaultFactory, abi: VAULT_FACTORY_ABI, functionName: "getVaultsByLender", args: [wallet] },
      { address: contracts.vaultFactory, abi: VAULT_FACTORY_ABI, functionName: "getVaultsByBorrower", args: [wallet] },
    ],
    query: { enabled: ready, refetchInterval: 15000 },
  });

  const { data: tokenList } = useReadContract({
    address: contracts.assetRegistry,
    abi: ASSET_REGISTRY_ABI,
    functionName: "getWhitelistedAssets",
    query: { enabled: ready && !isPlaceholder(contracts.assetRegistry) },
  });

  const asLender = lists?.[0]?.result || [];
  const asBorrower = lists?.[1]?.result || [];
  // A wallet that lent to itself through two accounts appears once.
  const seen = new Set();
  const addresses = [...asLender, ...asBorrower].filter((a) => {
    const k = a.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const { data, isLoading, refetch } = useReadContracts({
    contracts: addresses.flatMap((address) => FIELDS.map((functionName) => ({ address, abi: VAULT_ABI, functionName }))),
    query: { enabled: addresses.length > 0, refetchInterval: 15000 },
  });

  const tokens = tokenList || [];
  const { data: owedData, refetch: refetchOwed } = useReadContracts({
    contracts: addresses.flatMap((address) =>
      tokens.map((t) => ({ address, abi: VAULT_ABI, functionName: "owed", args: [t, wallet] }))
    ),
    query: { enabled: addresses.length > 0 && tokens.length > 0 && Boolean(wallet), refetchInterval: 15000 },
  });

  const me = (wallet || "").toLowerCase();

  const loans = addresses
    .map((address, i) => {
      const get = (n) => data?.[i * FIELDS.length + FIELDS.indexOf(n)]?.result;
      const asset = get("asset");
      if (!asset) return null;
      const symbol = symbolForToken(chainId, asset);
      const lender = get("lender") || "";
      const borrower = get("borrower") || "";
      const severity = Number(get("lossSeverity") ?? 0);

      // Formatted here, so no list of BigInts is passed down as a prop: React
      // 19's development build JSON-serialises changed props for its
      // performance log and throws on a BigInt inside an array.
      const owed = tokens
        .map((t, j) => {
          const symbol = symbolForToken(chainId, t);
          const amount = owedData?.[i * tokens.length + j]?.result ?? 0n;
          return { token: t, symbol, waiting: amount > 0n, display: formatTokenAmount(amount, TOKEN_DECIMALS[symbol] ?? 18) };
        })
        .filter((o) => o.waiting);

      return {
        address,
        role: lender.toLowerCase() === me ? (borrower.toLowerCase() === me ? "both" : "lender") : "borrower",
        isSettled: get("isSettled") === true,
        asset, symbol,
        decimals: TOKEN_DECIMALS[symbol] ?? 18,
        lender, borrower,
        principal: get("principal"),
        deposit: get("deposit"),
        aprBps: get("aprBps") != null ? Number(get("aprBps")) : undefined,
        termSeconds: get("term") != null ? Number(get("term")) : undefined,
        originatedAt: get("originatedAt") != null ? Number(get("originatedAt")) : 0,
        deadline: get("deadline") != null ? Number(get("deadline")) : 0,
        depositPaid: get("depositPaid") === true,
        // A loan whose deposit was never paid ends by cancellation; it is
        // not a settlement and has no outcome to speak of.
        cancelled: get("isSettled") === true && get("depositPaid") !== true,
        severity,
        severityLabel: SEVERITY_LABELS[severity],
        settledInKind: get("settledInKind") === true,
        settledTotalReturned: get("settledTotalReturned"),
        settledLenderPayout: get("settledLenderPayout"),
        settledBorrowerPayout: get("settledBorrowerPayout"),
        settledFee: get("settledFee"),
        settledInsuranceDraw: get("settledInsuranceDraw"),
        owed,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.originatedAt - a.originatedAt);

  const closed = loans.filter((l) => l.isSettled);
  const unclaimed = closed.filter((l) => l.owed.length > 0);

  return {
    loans,
    active: loans.filter((l) => !l.isSettled),
    closed,
    unclaimed,
    isLoading: ready && (isLoading || !lists),
    refetch: () => { refetchLists(); refetch(); refetchOwed(); },
  };
}
