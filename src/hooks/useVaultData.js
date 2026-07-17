import { useChainId, useReadContracts } from "wagmi";
import { parseAbi } from "viem";
import { VAULT_ABI, ERC20_ABI } from "../config/abis.js";
import { AAVE } from "../config/contracts.js";

const vaultAbi = parseAbi(VAULT_ABI);
const erc20Abi = parseAbi(ERC20_ABI);

const ARBITRUM_SEPOLIA_CHAIN_ID = 421614;

// Reads every field the UI needs for a single vault in one multicall,
// plus the vault's current aWETH balance (its Aave position, if any).
// The Aave read is skipped on any network other than Arbitrum Sepolia,
// since there's no real Aave deployment on a local Hardhat node.
export function useVaultData(vaultAddress) {
  const chainId = useChainId();
  const enabled = Boolean(vaultAddress);
  const aaveAvailable = chainId === ARBITRUM_SEPOLIA_CHAIN_ID;

  const { data, isLoading, refetch } = useReadContracts({
    contracts: [
      { address: vaultAddress, abi: vaultAbi, functionName: "lender" },
      { address: vaultAddress, abi: vaultAbi, functionName: "borrower" },
      { address: vaultAddress, abi: vaultAbi, functionName: "principal" },
      { address: vaultAddress, abi: vaultAbi, functionName: "deposit" },
      { address: vaultAddress, abi: vaultAbi, functionName: "requiredDeposit" },
      { address: vaultAddress, abi: vaultAbi, functionName: "feeRateBps" },
      { address: vaultAddress, abi: vaultAbi, functionName: "investedAmount" },
      { address: vaultAddress, abi: vaultAbi, functionName: "deadline" },
      { address: vaultAddress, abi: vaultAbi, functionName: "isSettled" },
      { address: vaultAddress, abi: vaultAbi, functionName: "isExpired" },
      { address: vaultAddress, abi: vaultAbi, functionName: "depositPaid" },
      { address: vaultAddress, abi: vaultAbi, functionName: "vaultBalance" },
      ...(aaveAvailable
        ? [
            {
              address: AAVE.wethAToken,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [vaultAddress],
            },
          ]
        : []),
    ],
    query: {
      enabled,
      refetchInterval: 10000,
    },
  });

  if (!enabled || !data) {
    return { vault: null, isLoading, refetch };
  }

  const [
    lender,
    borrower,
    principal,
    deposit,
    requiredDeposit,
    feeRateBps,
    investedAmount,
    deadline,
    isSettled,
    isExpired,
    depositPaid,
    vaultBalance,
    aWethBalanceResult,
  ] = data.map((d) => d.result);

  // Derived convenience value: the fixed fee owed to the lender, charged in
  // full regardless of early or on-time settlement. Not a separate on-chain
  // read — computed the same way Vault.sol computes it internally.
  const fee = principal != null && feeRateBps != null
    ? (principal * feeRateBps) / 10000n
    : undefined;

  return {
    vault: {
      address: vaultAddress,
      lender,
      borrower,
      principal,
      deposit,
      requiredDeposit,
      feeRateBps,
      fee,
      investedAmount,
      deadline,
      isSettled,
      isExpired,
      depositPaid,
      vaultBalance,
      aWethBalance: aaveAvailable ? aWethBalanceResult : 0n,
    },
    isLoading,
    refetch,
  };
}