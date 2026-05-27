const fs = require("node:fs");
const path = require("node:path");
const { normalizeAddress } = require("./env.cjs");

function deploymentDir(cwd = process.cwd()) {
  return path.join(cwd, "deployments", "dogeos-chikyu");
}

function readDeploymentJson(filename, cwd = process.cwd()) {
  const target = path.join(deploymentDir(cwd), filename);
  if (!fs.existsSync(target)) {
    return undefined;
  }

  return JSON.parse(fs.readFileSync(target, "utf8"));
}

function addressFromDeployment(filename, keys, label, cwd = process.cwd()) {
  const json = readDeploymentJson(filename, cwd);
  if (!json) {
    return undefined;
  }

  for (const key of keys) {
    if (json[key]) {
      return normalizeAddress(json[key], label);
    }
  }

  return undefined;
}

function resolveRouterAddress(config, cwd = process.cwd()) {
  return config.routerAddress || addressFromDeployment("router-latest.json", ["routerAddress"], "routerAddress", cwd);
}

function resolveAdapterAddress(config, cwd = process.cwd()) {
  return (
    config.adapterAddress ||
    addressFromDeployment("adapter-latest.json", ["adapterAddress"], "adapterAddress", cwd)
  );
}

module.exports = {
  addressFromDeployment,
  deploymentDir,
  readDeploymentJson,
  resolveAdapterAddress,
  resolveRouterAddress
};
