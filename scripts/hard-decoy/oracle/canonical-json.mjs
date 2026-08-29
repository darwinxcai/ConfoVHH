const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

function fail(message) {
  throw new Error(`Invalid strict JSON: ${message}`);
}

/**
 * Parse JSON while rejecting duplicate object keys and numerically ambiguous
 * values. JSON.parse alone silently accepts duplicate keys, which is unsafe for
 * signed scientific manifests.
 */
export function parseStrictJson(text, limits = {}) {
  if (typeof text !== "string" || text.length === 0) fail("input must be non-empty text");
  if (text.length > (limits.maximumCharacters ?? 4 * 1024 * 1024)) fail("input exceeds the character limit");
  if (text.charCodeAt(0) === 0xfeff) fail("a UTF-8 BOM is not allowed");
  if (text.includes("\0")) fail("NUL is not allowed");
  let index = 0;
  let tokenCount = 0;
  const maximumTokens = limits.maximumTokens ?? 1_000_000;
  const maximumDepth = limits.maximumDepth ?? 64;

  const countToken = () => {
    tokenCount += 1;
    if (tokenCount > maximumTokens) fail("input exceeds the token limit");
  };

  const whitespace = () => {
    while (index < text.length && /[\x20\x09\x0a\x0d]/u.test(text[index])) index += 1;
  };

  const stringValue = () => {
    if (text[index] !== '"') fail(`expected string at byte ${index}`);
    const start = index;
    index += 1;
    while (index < text.length) {
      const code = text.charCodeAt(index);
      if (code === 0x22) {
        index += 1;
        let value;
        try {
          value = JSON.parse(text.slice(start, index));
        } catch {
          fail(`malformed string at byte ${start}`);
        }
        for (let offset = 0; offset < value.length; offset += 1) {
          const unit = value.charCodeAt(offset);
          if (unit <= 0x1f || unit === 0x7f) fail("decoded control character");
          if (
            unit === 0x200e || unit === 0x200f || (unit >= 0x202a && unit <= 0x202e) ||
            (unit >= 0x2066 && unit <= 0x2069)
          ) fail("bidirectional control character");
          if (unit >= 0xd800 && unit <= 0xdbff) {
            const next = value.charCodeAt(offset + 1);
            if (!(next >= 0xdc00 && next <= 0xdfff)) fail("unpaired high surrogate");
            offset += 1;
          } else if (unit >= 0xdc00 && unit <= 0xdfff) {
            fail("unpaired low surrogate");
          }
        }
        return value;
      }
      if (code === 0x5c) {
        index += 1;
        if (index >= text.length) fail("unterminated escape");
        if (text[index] === "u") {
          if (!/^[a-fA-F0-9]{4}$/u.test(text.slice(index + 1, index + 5))) fail("invalid Unicode escape");
          index += 5;
        } else {
          if (!/["\\/bfnrt]/u.test(text[index])) fail("invalid string escape");
          index += 1;
        }
        continue;
      }
      if (code < 0x20) fail("unescaped control character");
      index += 1;
    }
    fail("unterminated string");
  };

  const value = (depth = 0) => {
    if (depth > maximumDepth) fail("input exceeds the nesting-depth limit");
    countToken();
    whitespace();
    const token = text[index];
    if (token === '"') return stringValue();
    if (token === "{") {
      index += 1;
      whitespace();
      const object = Object.create(null);
      const keys = new Set();
      if (text[index] === "}") {
        index += 1;
        return object;
      }
      while (index < text.length) {
        whitespace();
        const key = stringValue();
        if (keys.has(key)) fail(`duplicate object key ${JSON.stringify(key)}`);
        keys.add(key);
        whitespace();
        if (text[index] !== ":") fail(`expected colon at byte ${index}`);
        index += 1;
        object[key] = value(depth + 1);
        whitespace();
        if (text[index] === "}") {
          index += 1;
          return object;
        }
        if (text[index] !== ",") fail(`expected comma at byte ${index}`);
        index += 1;
      }
      fail("unterminated object");
    }
    if (token === "[") {
      index += 1;
      whitespace();
      const array = [];
      if (text[index] === "]") {
        index += 1;
        return array;
      }
      while (index < text.length) {
        array.push(value(depth + 1));
        whitespace();
        if (text[index] === "]") {
          index += 1;
          return array;
        }
        if (text[index] !== ",") fail(`expected comma at byte ${index}`);
        index += 1;
      }
      fail("unterminated array");
    }
    for (const [literal, parsed] of [["true", true], ["false", false], ["null", null]]) {
      if (text.startsWith(literal, index)) {
        index += literal.length;
        return parsed;
      }
    }
    NUMBER.lastIndex = index;
    const match = NUMBER.exec(text);
    if (!match) fail(`unexpected token at byte ${index}`);
    index = NUMBER.lastIndex;
    const parsed = Number(match[0]);
    if (!Number.isFinite(parsed) || Object.is(parsed, -0)) fail("nonfinite or negative-zero number");
    if (Number.isInteger(parsed) && !Number.isSafeInteger(parsed)) fail("unsafe integer");
    return parsed;
  };

  const parsed = value();
  whitespace();
  if (index !== text.length) fail(`trailing bytes at byte ${index}`);
  return parsed;
}

function assertCanonicalValue(value, trail = "$") {
  if (value === null || typeof value === "boolean" || typeof value === "string") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) throw new Error(`${trail} has a noncanonical number.`);
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) throw new Error(`${trail} has an unsafe integer.`);
    return;
  }
  if (Array.isArray(value)) {
    const own = Reflect.ownKeys(value);
    const expected = ["length", ...value.map((_, index) => String(index))];
    if (own.length !== expected.length || own.some((key) => !expected.includes(key))) {
      throw new Error(`${trail} has non-index array properties.`);
    }
    value.forEach((item, itemIndex) => assertCanonicalValue(item, `${trail}[${itemIndex}]`));
    return;
  }
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== null && Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`${trail} is not a plain JSON value.`);
  }
  const enumerableKeys = Object.keys(value);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== enumerableKeys.length || ownKeys.some((key) => typeof key !== "string" || !enumerableKeys.includes(key))) {
    throw new Error(`${trail} has symbol or nonenumerable properties.`);
  }
  for (const [key, item] of Object.entries(value)) {
    if (!/^[\x20-\x7e]+$/u.test(key)) throw new Error(`${trail} has a non-ASCII or empty key.`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || typeof descriptor.get === "function" || typeof descriptor.set === "function") {
      throw new Error(`${trail}.${key} is not one inert data property.`);
    }
    assertCanonicalValue(item, `${trail}.${key}`);
  }
}

/** ConfovHH canonical JSON v1: recursively sorted ASCII keys, no whitespace. */
export function canonicalJson(value) {
  assertCanonicalValue(value);
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

/** Parse the restricted RFC 8785 profile and require exact canonical bytes. */
export function parseCanonicalJson(text, limits = {}) {
  const value = parseStrictJson(text, limits);
  if (canonicalJson(value) !== text) fail("input is not canonical JSON");
  return value;
}
