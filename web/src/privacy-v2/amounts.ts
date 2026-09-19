import { parseUnits } from "viem";

/** Reject excess precision instead of silently rounding a financial input. */
export function exactUnits(value: string, decimals: number): string {
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 36)
    throw new Error("Unsupported asset precision.");
  const pattern =
    decimals === 0
      ? /^(0|[1-9][0-9]*)$/
      : new RegExp(`^(0|[1-9][0-9]*)(\\.[0-9]{1,${decimals}})?$`);
  if (value.length > 100 || !pattern.test(value))
    throw new Error(
      `Enter an amount with no more than ${decimals} decimal places.`,
    );
  const amount = parseUnits(value, decimals);
  if (amount <= 0n || amount >= 2n ** 256n)
    throw new Error("Enter a positive amount within the supported range.");
  return amount.toString();
}
