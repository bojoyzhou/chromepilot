import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const packageJsonPath = "package.json";
const lockJsonPath = "package-lock.json";
const extensionManifestSourcePath = "src/extension/manifest.ts";

const EXTENSION_PATH_PREFIXES = [
  "src/extension/",
  "public/",
  "extension/",
  "vite.config.ts",
  "tsconfig.json",
];

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function runCapture(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
  return (result.stdout || "").trim();
}

function gitOk(args) {
  const result = spawnSync("git", args, { stdio: "ignore", shell: false });
  return result.status === 0;
}

function gitCaptureOk(args) {
  const result = spawnSync("git", args, { encoding: "utf8", shell: false });
  if (result.status !== 0) return null;
  return (result.stdout || "").trim();
}

function parsePrePushRefs() {
  const raw = readFileSync(0, { encoding: "utf8" }).trim();
  if (!raw) return [];
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/);
      if (parts.length < 4) return null;
      const localSha = parts[1];
      const remoteSha = parts[3];
      return { localSha, remoteSha };
    })
    .filter(Boolean);
}

function parseFallbackPushRangeFromUpstream() {
  const upstream = gitCaptureOk(["rev-parse", "-q", "--verify", "@{u}"]);
  if (!upstream) return null;

  const localSha = gitCaptureOk(["rev-parse", "HEAD"]);
  if (!localSha) return null;

  return { localSha, remoteSha: upstream };
}

function isAllZeroSha(sha) {
  return /^0+$/.test(sha);
}

function listChangedFilesBetween(baseSha, headSha) {
  if (!baseSha || isAllZeroSha(baseSha)) {
    // New branch / no remote tip: best-effort diff against empty tree.
    return runCapture("git", ["diff-tree", "--no-commit-id", "--name-only", "-r", headSha]).split("\n").filter(Boolean);
  }
  return runCapture("git", ["diff", "--name-only", `${baseSha}...${headSha}`]).split("\n").filter(Boolean);
}

function shouldReleaseForChangedFiles(files) {
  return files.some((f) => EXTENSION_PATH_PREFIXES.some((p) => f === p || f.startsWith(p)));
}

function bumpPatch(version) {
  const parts = version.split(".");
  if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) {
    throw new Error(`Unsupported version format: ${version}`);
  }
  const [major, minor, patch] = parts.map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

function updatePackageVersion(newVersion) {
  const pkgRaw = readFileSync(packageJsonPath, "utf8");
  const pkg = JSON.parse(pkgRaw);
  pkg.version = newVersion;
  writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

function updateLockfileVersion(newVersion) {
  const lockRaw = readFileSync(lockJsonPath, "utf8");
  const lock = JSON.parse(lockRaw);
  lock.version = newVersion;
  if (lock.packages && lock.packages[""]) {
    lock.packages[""].version = newVersion;
  }
  writeFileSync(lockJsonPath, `${JSON.stringify(lock, null, 2)}\n`);
}

function updateExtensionManifestVersion(newVersion) {
  const manifestRaw = readFileSync(extensionManifestSourcePath, "utf8");
  const next = manifestRaw.replace(/version:\s*"[^"]+"/, `version: "${newVersion}"`);
  if (next === manifestRaw) {
    throw new Error(`Could not update version in ${extensionManifestSourcePath}`);
  }
  writeFileSync(extensionManifestSourcePath, next);
}

function stageFiles(paths) {
  run("git", ["add", ...paths]);
}

function assertNoUnstagedChangesOrExit(message) {
  if (!gitOk(["diff", "--quiet"])) {
    console.error(message);
    process.exit(1);
  }
}

function assertIndexMatchesHeadOrExit(message) {
  if (!gitOk(["diff", "--cached", "--quiet"])) {
    console.error(message);
    process.exit(1);
  }
}

function main() {
  let refs = parsePrePushRefs();
  if (refs.length === 0) {
    const upstreamFallback = parseFallbackPushRangeFromUpstream();
    if (upstreamFallback) {
      console.log("[pre-push] stdin empty; falling back to diff vs @{u}...HEAD");
      refs = [upstreamFallback];
    } else {
      const headSha = gitCaptureOk(["rev-parse", "HEAD"]);
      if (!headSha) {
        console.log("[pre-push] no ref updates; skip release");
        return;
      }

      console.log("[pre-push] stdin empty and no @{u}; falling back to all commits reachable from HEAD");
      refs = [{ localSha: headSha, remoteSha: "0".repeat(40) }];
    }
  }

  // Aggregate file changes across all pushed ref updates (usually one line).
  const changed = new Set();
  for (const ref of refs) {
    for (const f of listChangedFilesBetween(ref.remoteSha, ref.localSha)) changed.add(f);
  }

  const files = [...changed];
  if (!shouldReleaseForChangedFiles(files)) {
    console.log("[pre-push] no extension-related changes; skip version bump + build");
    return;
  }

  assertNoUnstagedChangesOrExit("[pre-push] unstaged changes detected; commit/stash before pushing.");
  assertIndexMatchesHeadOrExit("[pre-push] staged changes detected; commit/stash before pushing.");

  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const nextVersion = bumpPatch(pkg.version);

  updatePackageVersion(nextVersion);
  updateLockfileVersion(nextVersion);
  updateExtensionManifestVersion(nextVersion);

  // Bump + manifest updates should be staged before build so failures don't leave half-applied artifacts.
  stageFiles([packageJsonPath, lockJsonPath, extensionManifestSourcePath]);

  run("npm", ["run", "build"]);

  stageFiles(["extension", "public"]);

  assertNoUnstagedChangesOrExit(
    [
      "[pre-push] release produced unstaged changes (or failed to stage everything).",
      "Fix: review `git status`, stage the missing files, then commit/amend as needed and push again.",
    ].join("\n"),
  );

  console.log(
    [
      `[pre-push] staged release bump ${pkg.version} -> ${nextVersion} + build artifacts.`,
      "Next: include these changes in a commit (often `git commit --amend --no-edit`) and push again.",
    ].join("\n"),
  );
  process.exit(1);
}

main();
