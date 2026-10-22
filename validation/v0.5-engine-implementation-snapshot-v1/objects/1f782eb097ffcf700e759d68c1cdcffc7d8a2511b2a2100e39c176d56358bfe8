import assert from "node:assert/strict";

export const DOCKQ_REPLAY_SASA_TOLERANCES = Object.freeze({
  deltaSasaAngstrom2: 1e-9,
  halfDeltaSasaInterfaceAreaAngstrom2: 5e-10,
});

const SASA_FIELDS = Object.freeze(Object.keys(DOCKQ_REPLAY_SASA_TOLERANCES));

function finiteAuditValue(audit, field, context) {
  const value = audit[field];
  assert.equal(
    Number.isFinite(value),
    true,
    `${context}: ${field} must be finite`,
  );
  return value;
}

export function compareAuditWithSasaTolerance(expected, observed, context) {
  const expectedCopy = structuredClone(expected);
  const observedCopy = structuredClone(observed);
  const sasa = {};

  for (const field of SASA_FIELDS) {
    const expectedValue = finiteAuditValue(expectedCopy, field, context);
    const observedValue = finiteAuditValue(observedCopy, field, context);
    const absoluteDifference = Math.abs(observedValue - expectedValue);
    const tolerance = DOCKQ_REPLAY_SASA_TOLERANCES[field];
    assert.ok(
      absoluteDifference <= tolerance,
      `${context}: ${field} drift ${absoluteDifference} exceeds ${tolerance}`,
    );
    sasa[field] = {
      expected: expectedValue,
      observed: observedValue,
      absoluteDifference,
      tolerance,
      withinTolerance: true,
      exactMatch: Object.is(expectedValue, observedValue),
    };
    delete expectedCopy[field];
    delete observedCopy[field];
  }

  assert.deepEqual(
    observedCopy,
    expectedCopy,
    `${context}: normalized non-SASA audit fields changed`,
  );

  return {
    exactNonSasaMatch: true,
    sasaWithinTolerance: true,
    exactFullMatch: SASA_FIELDS.every((field) => sasa[field].exactMatch),
    ...sasa,
  };
}
