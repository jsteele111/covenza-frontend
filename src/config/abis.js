import { parseAbi } from "viem";

import kycRegistryAbi from "./abi/KYCRegistry.json";
import vaultFactoryAbi from "./abi/VaultFactory.json";
import vaultAbi from "./abi/Vault.json";
import assetRegistryAbi from "./abi/AssetRegistry.json";
import insurancePoolAbi from "./abi/InsurancePool.json";
import vaultLensAbi from "./abi/VaultLens.json";

// Covenza's own contracts: exact ABIs exported from the build of the commit
// frozen for audit (tag audit-freeze-2026-10, fef1abc).
//
// These used to be hand-written human-readable fragments, kept "to only what
// the front-end calls". That is how the frontend drifted out of step with the
// contracts: VaultFactory.Mandate gained two fields (totalCapacity, filled),
// the hand-written tuple did not, and every mandate read would have failed to
// decode. An ABI copied from the compiler cannot disagree with the contract it
// came from. To refresh after a contract change:
//
//   cd lending-poc && npx hardhat compile
//   then copy artifacts/contracts/<Name>.sol/<Name>.json -> .abi into src/config/abi/<Name>.json
//
// JSON ABIs go straight to wagmi/viem — no parseAbi() needed (that was only
// ever required for the human-readable string form).
export const KYC_REGISTRY_ABI = kycRegistryAbi;
export const VAULT_FACTORY_ABI = vaultFactoryAbi;
export const VAULT_ABI = vaultAbi;
export const ASSET_REGISTRY_ABI = assetRegistryAbi;
export const INSURANCE_POOL_ABI = insurancePoolAbi;

// Read-only quote helper. Moved off Vault for contract size; holds no state
// and nothing in the protocol calls it. quoteSwapOut(vault, tokenOut, amountIn,
// poolFee) prices a prospective swap at the TWAP and returns the minimum the
// vault itself would accept.
export const VAULT_LENS_ABI = vaultLensAbi;

// --- Third-party contracts: only what the app calls, hand-written ---
//
// IMPORTANT: human-readable fragments must be wrapped in viem's parseAbi().
// Passing a raw array of strings to wagmi's hooks throws "Cannot use 'in'
// operator to search for 'name' in <string>".

export const ERC20_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

// Uniswap V3, read-only. Used by the whitelist pre-flight to establish whether
// an asset can be force-settled before it is listed, and whether its pool keeps
// enough price history to be approved (audit KRAIT-004).
export const UNISWAP_V3_FACTORY_ABI = parseAbi([
  "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address)",
]);

export const UNISWAP_V3_POOL_ABI = parseAbi([
  "function observe(uint32[] secondsAgos) view returns (int56[] tickCumulatives, uint160[] secondsPerLiquidityCumulativeX128s)",
  "function liquidity() view returns (uint128)",
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
]);

// WETH adds wrap/unwrap on top of the standard ERC20 surface.
export const WETH_ABI = [
  ...ERC20_ABI,
  ...parseAbi([
    "function deposit() payable",
    "function withdraw(uint256 amount)",
  ]),
];
