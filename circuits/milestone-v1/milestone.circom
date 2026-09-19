pragma circom 2.2.2;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";

// Prove a certified, blinded USD-cent balance reaches a chosen threshold.
// Neither a wallet nor a child's identity is a circuit input.
template PrivateMilestone() {
    signal input commitment;
    signal input threshold;
    signal input scope;
    signal input balance;
    signal input salt;

    // Comparators alone do not range-check their inputs. Constrain both.
    component balanceBits = Num2Bits(64);
    component thresholdBits = Num2Bits(64);
    component scopeBits = Num2Bits(128);
    component saltBits = Num2Bits(248);
    balanceBits.in <== balance;
    thresholdBits.in <== threshold;
    scopeBits.in <== scope;
    saltBits.in <== salt;
    component nonzero = IsZero();
    nonzero.in <== threshold;
    nonzero.out === 0;
    component reached = GreaterEqThan(64);
    reached.in[0] <== balance;
    reached.in[1] <== threshold;
    reached.out === 1;

    // A fresh scope and salt prevent different issued snapshots sharing a commitment.
    component certificate = Poseidon(3);
    certificate.inputs[0] <== balance;
    certificate.inputs[1] <== salt;
    certificate.inputs[2] <== scope;
    commitment === certificate.out;
}

component main { public [commitment, threshold, scope] } = PrivateMilestone();
