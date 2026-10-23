import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const braces = require("braces");
const metadata = require("braces/package.json");
const rejectsDepth = (error) =>
  error instanceof SyntaxError && error.code === "ERR_BRACES_MAX_DEPTH";

test("the installed glob parser uses the identified local security patch", () => {
  assert.equal(metadata.name, "@confovhh/braces-depth-guard");
  assert.equal(metadata.version, "3.0.3-confovhh.1");
  const micromatchRequire = createRequire(require.resolve("micromatch"));
  assert.equal(micromatchRequire("braces"), braces);
});

test("deep brace, parenthesis and mixed patterns are rejected before stack exhaustion", () => {
  for (const [open, close] of [["{", "}"], ["(", ")"], ["({", "})"]]) {
    const pattern = open.repeat(2000) + "a,b" + close.repeat(2000);
    assert.ok(pattern.length < 10000);
    for (const run of [braces, braces.parse, braces.compile, braces.expand, braces.stringify]) {
      assert.throws(() => run(pattern), rejectsDepth);
      assert.throws(() => run(pattern, { maxDepth: Infinity }), rejectsDepth);
    }
  }
});

test("direct AST input and child cycles cannot bypass the depth guard", () => {
  let ast = { type: "text", value: "a" };
  for (let i = 0; i < 4000; i++) ast = { type: "root", nodes: [ast] };
  for (const run of [braces.compile, braces.expand, braces.stringify]) {
    assert.throws(() => run(ast), rejectsDepth);
  }
  const cyclic = { type: "root", nodes: [] };
  cyclic.nodes.push(cyclic);
  for (const run of [braces.compile, braces.expand, braces.stringify]) {
    assert.throws(() => run(cyclic), rejectsDepth);
  }
});

test("malformed iterable and array-like AST children cannot bypass the guard", () => {
  for (const nodes of [new Set([{ type: "text", value: "a" }]), { 0: { type: "text", value: "a" }, length: 1 }]) {
    const ast = { type: "root", nodes };
    for (const run of [braces.compile, braces.expand, braces.stringify]) {
      assert.throws(() => run(ast), (error) =>
        error instanceof SyntaxError && error.code === "ERR_BRACES_INVALID_AST");
    }
  }
  let value = "a";
  for (let i = 0; i < 10000; i++) value = [value];
  const ast = { type: "root", nodes: [{ type: "text", value }] };
  for (const run of [braces.compile, braces.expand, braces.stringify]) {
    assert.throws(() => run(ast), (error) =>
      error instanceof SyntaxError && error.code === "ERR_BRACES_INVALID_AST");
  }
});

test("normal ranges, nested sets, escaped text and parser ASTs retain expected results", () => {
  assert.deepEqual(braces.expand("src/{app,components}/**/*.{ts,tsx}"), [
    "src/app/**/*.ts", "src/app/**/*.tsx", "src/components/**/*.ts", "src/components/**/*.tsx",
  ]);
  assert.deepEqual(braces.expand("{01..05..2}"), ["01", "03", "05"]);
  assert.deepEqual(braces.expand("{a,{b,c}}"), ["a", "b", "c"]);
  assert.equal(braces.compile("src/{app,components}/*.js"), "src/(app|components)/*.js");
  const pattern = "a/{b,c}/d";
  assert.equal(braces.compile(braces.parse(pattern)), "a/(b|c)/d");
  assert.deepEqual(braces.expand(braces.parse(pattern)), ["a/b/d", "a/c/d"]);
  assert.equal(braces.stringify(braces.parse(pattern)), pattern);
  assert.equal(braces.compile("\\{".repeat(1000)), "{".repeat(1000));
  assert.equal(braces.stringify("\"" + "{".repeat(1000) + "\""), "{".repeat(1000));
});

test("the documented depth boundary accepts 100 levels and rejects the next", () => {
  const pattern = (count) => "{".repeat(count) + "x" + "}".repeat(count);
  for (const run of [braces.parse, braces.compile, braces.expand, braces.stringify]) {
    assert.doesNotThrow(() => run(pattern(100)));
    assert.throws(() => run(pattern(101)), rejectsDepth);
  }
});
