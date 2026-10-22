'use strict';

// Fixed independently of caller options: a user-provided maxDepth cannot
// re-enable the unbounded recursion described by GHSA-vfj7-8cjw-p6xm.
const MAX_NESTING = 100;

const fail = () => {
  const error = new SyntaxError(`Brace pattern nesting exceeds maximum depth (${MAX_NESTING})`);
  error.code = 'ERR_BRACES_MAX_DEPTH';
  throw error;
};

// parse() uses an iterative stack, including the root; reject the next
// structural block before any recursive walker can receive an unsafe tree.
const assertParserDepth = stackLength => {
  if (stackLength > MAX_NESTING) fail();
};

// Public compile/expand/stringify also accept caller-constructed ASTs. Walk
// children iteratively, ignoring the expected parent/prev backlinks, before
// invoking the unchanged upstream recursive algorithm. Detect child cycles.
const assertAstDepth = ast => {
  const active = new Set();
  const stack = [{ node: ast, depth: 0, leaving: false }];
  while (stack.length) {
    const entry = stack.pop();
    const node = entry.node;
    if (!node) continue;
    if (node.value !== undefined && typeof node.value !== 'string') {
      const error = new SyntaxError('Brace AST values must be strings');
      error.code = 'ERR_BRACES_INVALID_AST';
      throw error;
    }
    if (node.nodes === undefined) continue;
    // Upstream walkers also accept some iterable/array-like inputs. Requiring
    // the parser's actual AST representation prevents those shapes from
    // bypassing this preflight and reaching unbounded recursive processing.
    if (!Array.isArray(node.nodes)) {
      const error = new SyntaxError('Brace AST nodes must be an array');
      error.code = 'ERR_BRACES_INVALID_AST';
      throw error;
    }
    if (entry.leaving) {
      active.delete(node);
      continue;
    }
    if (entry.depth > MAX_NESTING || active.has(node)) fail();
    active.add(node);
    stack.push({ node, depth: entry.depth, leaving: true });
    for (let i = node.nodes.length - 1; i >= 0; i--) {
      stack.push({ node: node.nodes[i], depth: entry.depth + 1, leaving: false });
    }
  }
};

module.exports = { assertParserDepth, assertAstDepth };
