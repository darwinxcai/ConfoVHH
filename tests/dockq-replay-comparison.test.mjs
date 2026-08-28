import assert from "node:assert/strict";
import test from "node:test";

import {
  compareAuditWithSasaTolerance,
  DOCKQ_REPLAY_SASA_TOLERANCES,
} from "../scripts/dockq-replay-comparison.mjs";

function audit(overrides = {}) {
  return {
    contactPairCount: 46,
    evidenceLevel: "supported",
    deltaSasaAngstrom2: 1729.261866528693,
    halfDeltaSasaInterfaceAreaAngstrom2: 864.6309332643465,
    ...overrides,
  };
}

test("DockQ replay audit comparison keeps exact non-SASA fields and reports exact SASA", () => {
  const expected = audit();
  const observed = structuredClone(expected);
  const result = compareAuditWithSasaTolerance(expected, observed, "exact fixture");
  assert.equal(result.exactNonSasaMatch, true);
  assert.equal(result.sasaWithinTolerance, true);
  assert.equal(result.exactFullMatch, true);
  assert.equal(result.deltaSasaAngstrom2.absoluteDifference, 0);
  assert.equal(result.halfDeltaSasaInterfaceAreaAngstrom2.absoluteDifference, 0);
  assert.deepEqual(observed, expected);
});

test("DockQ replay audit comparison accepts and exposes bounded floating SASA drift", () => {
  const expected = audit();
  const observed = audit({
    deltaSasaAngstrom2: expected.deltaSasaAngstrom2 + 5e-10,
    halfDeltaSasaInterfaceAreaAngstrom2:
      expected.halfDeltaSasaInterfaceAreaAngstrom2 + 2.5e-10,
  });
  const result = compareAuditWithSasaTolerance(expected, observed, "bounded fixture");
  assert.equal(result.exactNonSasaMatch, true);
  assert.equal(result.sasaWithinTolerance, true);
  assert.equal(result.exactFullMatch, false);
  assert.ok(
    result.deltaSasaAngstrom2.absoluteDifference <=
      DOCKQ_REPLAY_SASA_TOLERANCES.deltaSasaAngstrom2,
  );
  assert.ok(
    result.halfDeltaSasaInterfaceAreaAngstrom2.absoluteDifference <=
      DOCKQ_REPLAY_SASA_TOLERANCES.halfDeltaSasaInterfaceAreaAngstrom2,
  );
});

test("DockQ replay audit comparison accepts signed drift through the exact boundary", () => {
  const expected = audit({
    deltaSasaAngstrom2: 0,
    halfDeltaSasaInterfaceAreaAngstrom2: 0,
  });
  const positiveBoundary = audit({
    deltaSasaAngstrom2: DOCKQ_REPLAY_SASA_TOLERANCES.deltaSasaAngstrom2,
    halfDeltaSasaInterfaceAreaAngstrom2:
      DOCKQ_REPLAY_SASA_TOLERANCES.halfDeltaSasaInterfaceAreaAngstrom2,
  });
  assert.equal(
    compareAuditWithSasaTolerance(expected, positiveBoundary, "positive boundary")
      .sasaWithinTolerance,
    true,
  );

  const negativeExpected = audit({
    deltaSasaAngstrom2: 1e-8,
    halfDeltaSasaInterfaceAreaAngstrom2: 5e-9,
  });
  const negativeObserved = audit({
    deltaSasaAngstrom2: 9.5e-9,
    halfDeltaSasaInterfaceAreaAngstrom2: 4.75e-9,
  });
  const negative = compareAuditWithSasaTolerance(
    negativeExpected,
    negativeObserved,
    "negative drift",
  );
  assert.ok(negative.deltaSasaAngstrom2.observed < negative.deltaSasaAngstrom2.expected);
  assert.equal(negative.sasaWithinTolerance, true);
});

test("DockQ replay audit comparison rejects just beyond the exact boundary", () => {
  const expected = audit({
    deltaSasaAngstrom2: 0,
    halfDeltaSasaInterfaceAreaAngstrom2: 0,
  });
  assert.throws(
    () => compareAuditWithSasaTolerance(
      expected,
      audit({
        deltaSasaAngstrom2:
          DOCKQ_REPLAY_SASA_TOLERANCES.deltaSasaAngstrom2 * (1 + 1e-6),
        halfDeltaSasaInterfaceAreaAngstrom2:
          DOCKQ_REPLAY_SASA_TOLERANCES.halfDeltaSasaInterfaceAreaAngstrom2 *
          (1 + 1e-6),
      }),
      "just over boundary",
    ),
    /deltaSasaAngstrom2 drift .* exceeds/u,
  );
});

test("DockQ replay audit comparison rejects either SASA field beyond tolerance", () => {
  const expected = audit();
  assert.throws(
    () => compareAuditWithSasaTolerance(
      expected,
      audit({ deltaSasaAngstrom2: expected.deltaSasaAngstrom2 + 2e-9 }),
      "delta overflow",
    ),
    /deltaSasaAngstrom2 drift .* exceeds/u,
  );
  assert.throws(
    () => compareAuditWithSasaTolerance(
      expected,
      audit({
        halfDeltaSasaInterfaceAreaAngstrom2:
          expected.halfDeltaSasaInterfaceAreaAngstrom2 + 1e-9,
      }),
      "half overflow",
    ),
    /halfDeltaSasaInterfaceAreaAngstrom2 drift .* exceeds/u,
  );
});

test("DockQ replay audit comparison rejects non-SASA and non-finite drift", () => {
  const expected = audit();
  assert.throws(
    () => compareAuditWithSasaTolerance(
      expected,
      audit({ contactPairCount: 45 }),
      "discrete drift",
    ),
    /non-SASA audit fields changed/u,
  );
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.throws(
      () => compareAuditWithSasaTolerance(
        expected,
        audit({ deltaSasaAngstrom2: value }),
        "nonfinite drift",
      ),
      /must be finite/u,
    );
  }
  const missing = audit();
  delete missing.deltaSasaAngstrom2;
  assert.throws(
    () => compareAuditWithSasaTolerance(expected, missing, "missing field"),
    /deltaSasaAngstrom2 must be finite/u,
  );
});

test("DockQ replay audit comparison never mutates either supplied audit", () => {
  const expected = audit();
  const observed = audit({
    deltaSasaAngstrom2: expected.deltaSasaAngstrom2 + 5e-10,
    halfDeltaSasaInterfaceAreaAngstrom2:
      expected.halfDeltaSasaInterfaceAreaAngstrom2 + 2.5e-10,
  });
  const expectedSnapshot = structuredClone(expected);
  const observedSnapshot = structuredClone(observed);
  compareAuditWithSasaTolerance(expected, observed, "nonmutation fixture");
  assert.deepEqual(expected, expectedSnapshot);
  assert.deepEqual(observed, observedSnapshot);
});
