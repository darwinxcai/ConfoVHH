import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";

export const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function assertSafeBasename(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value) || path.basename(value) !== value) {
    throw new Error(`${label} must be one bounded ASCII basename.`);
  }
}

export async function assertPrivateDirectory(directory, label = "Oracle vault") {
  const absolute = path.resolve(directory);
  const info = await lstat(absolute, { bigint: true });
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`${label} must be one direct directory.`);
  if (await realpath(absolute) !== absolute) throw new Error(`${label} cannot contain symlinked ancestors.`);
  if ((Number(info.mode) & 0o077) !== 0) throw new Error(`${label} permissions must exclude group and other access.`);
  return absolute;
}

/**
 * Read one regular, single-link file twice through the same O_NOFOLLOW
 * descriptor. This rejects symlink, hardlink, inode-swap, and same-size TOCTOU
 * attempts before scientific content is trusted.
 */
export async function readStableFile(filename, options = {}) {
  const absolute = path.resolve(filename);
  const maximumBytes = BigInt(options.maximumBytes ?? 8 * 1024 * 1024);
  const requirePrivate = options.requirePrivate === true;
  const before = await lstat(absolute, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n) {
    throw new Error("Secure input must be one direct single-link regular file.");
  }
  if (await realpath(absolute) !== absolute) throw new Error("Secure input cannot contain symlinked ancestors.");
  if (before.size > maximumBytes) throw new Error("Secure input exceeds its frozen byte limit.");
  if (requirePrivate && (Number(before.mode) & 0o077) !== 0) {
    throw new Error("Private oracle material permissions must exclude group and other access.");
  }

  const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat({ bigint: true });
    if (
      !opened.isFile() || opened.nlink !== 1n || opened.dev !== before.dev || opened.ino !== before.ino ||
      opened.size !== before.size || opened.mtimeNs !== before.mtimeNs || opened.ctimeNs !== before.ctimeNs
    ) {
      throw new Error("Secure input changed while opening.");
    }
    const first = await handle.readFile();
    const second = Buffer.alloc(first.byteLength);
    const reread = await handle.read(second, 0, second.byteLength, 0);
    const after = await handle.stat({ bigint: true });
    if (
      reread.bytesRead !== first.byteLength || !first.equals(second) || after.dev !== opened.dev ||
      after.ino !== opened.ino || after.size !== opened.size || after.mtimeNs !== opened.mtimeNs ||
      after.ctimeNs !== opened.ctimeNs
    ) {
      throw new Error("Secure input changed while reading.");
    }
    return first;
  } finally {
    await handle.close();
  }
}

export function decodeUtf8(bytes, label) {
  if (bytes.byteLength >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new Error(`${label} cannot begin with a UTF-8 BOM.`);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new Error(`${label} must be valid UTF-8.`);
  }
}

export async function readContainedStableFile(directory, basename, options = {}) {
  const root = path.resolve(directory);
  assertSafeBasename(basename, options.label ?? "Input filename");
  const filename = path.resolve(root, basename);
  if (path.dirname(filename) !== root) throw new Error("Secure input escaped its allowlisted directory.");
  return readStableFile(filename, options);
}

export async function writeExclusiveDurableFile(filename, bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.byteLength === 0) throw new Error("Oracle output must be non-empty bytes.");
  const absolute = path.resolve(filename);
  const directory = await assertPrivateDirectory(path.dirname(absolute), "Oracle output directory");
  assertSafeBasename(path.basename(absolute), "Oracle output filename");
  if (path.dirname(absolute) !== directory) throw new Error("Oracle output escaped its allowlisted directory.");
  const handle = await open(
    absolute,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  const directoryHandle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    await directoryHandle.sync();
  } finally {
    await directoryHandle.close();
  }
}
