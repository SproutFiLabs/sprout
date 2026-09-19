/// <reference path="./circomlibjs.d.ts" />
import { buildPoseidon } from 'circomlibjs';
let poseidon: ReturnType<typeof buildPoseidon> | undefined;
export async function milestoneCommitment(balance: string, salt: string, scope: string): Promise<string> {
  const hash = await (poseidon ??= buildPoseidon());
  return hash.F.toObject(hash([BigInt(balance), BigInt(salt), BigInt(scope)])).toString();
}
