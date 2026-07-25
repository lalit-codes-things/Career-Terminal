const fs = require("fs");
const path = require("path");

const k8sDir = path.join(process.cwd(), "k8s");
const mutableTags = new Set(["latest", "stable", "production"]);
const imagePattern = /^\s*image:\s*([^\s#]+).*$/gm;
const failures = [];

for (const entry of fs.readdirSync(k8sDir, { withFileTypes: true })) {
  if (!entry.isFile() || !/\.ya?ml$/i.test(entry.name)) {
    continue;
  }

  const filePath = path.join(k8sDir, entry.name);
  const content = fs.readFileSync(filePath, "utf8");
  let match;

  while ((match = imagePattern.exec(content)) !== null) {
    const image = match[1].replace(/^["']|["']$/g, "");
    const line = content.slice(0, match.index).split(/\r?\n/).length;
    const hasDigest = image.includes("@sha256:");
    const tag = hasDigest ? null : image.split("/").pop().split(":")[1];

    if (!hasDigest && (!tag || mutableTags.has(tag))) {
      failures.push(`${path.relative(process.cwd(), filePath)}:${line} uses mutable image reference "${image}"`);
    }
  }
}

if (failures.length > 0) {
  console.error("Kubernetes images must use immutable tags or digests:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Kubernetes image references are immutable.");
