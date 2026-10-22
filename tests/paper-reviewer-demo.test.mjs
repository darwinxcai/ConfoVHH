import assert from "node:assert/strict";
import test from "node:test";
import { runReviewerDemo } from "../scripts/paper/reviewer-demo.mjs";

test("offline reviewer example checks a contact oracle, no-contact control and export integrity", () => {
  const first = runReviewerDemo();
  assert.deepEqual(runReviewerDemo(), first);
  assert.ok(first.cases[0].residuePairs > 0);
  assert.equal(first.cases[1].atomContacts, 0);
  assert.equal(Object.keys(first.artifacts).length, 4);
});
