import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const packageJsonPath = "package.json";
const lockJsonPath = "package-lock.json";
const extensionManifestSourcePath = "src/extension/manifest.ts";

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

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function stageFiles(paths) {
  run("git", ["add", ...paths]);
}

function main() {
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const nextVersion = bumpPatch(pkg.version);

  updatePackageVersion(nextVersion);
  updateLockfileVersion(nextVersion);
  updateExtensionManifestVersion(nextVersion);

  

  stageFiles([
    packageJsonPath,
    lockJsonPath,
    extensionManifestSourcePath,
    "extension",
  ]);

  run("npm", ["run", "build"]);

  // Keep public icon source changes if they happen during migration.
  stageFiles(["public"]);

  console.log(`[pre-commit] bumped version ${pkg.version} -> ${nextVersion}`);
}

main();
