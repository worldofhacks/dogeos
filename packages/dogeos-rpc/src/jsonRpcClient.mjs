function assertHexQuantity(value, fieldName) {
  if (!/^0x[0-9a-fA-F]+$/.test(value ?? "")) {
    throw new Error(`${fieldName} must be a JSON-RPC hex quantity.`);
  }
}

function hexQuantityToBigInt(value, fieldName) {
  assertHexQuantity(value, fieldName);
  return BigInt(value);
}

function hexQuantityToNumber(value, fieldName) {
  const parsed = hexQuantityToBigInt(value, fieldName);
  const asNumber = Number(parsed);

  if (!Number.isSafeInteger(asNumber)) {
    throw new Error(`${fieldName} exceeds JavaScript safe integer range.`);
  }

  return asNumber;
}

function bigintToHexQuantity(value, fieldName) {
  const normalized = BigInt(value);
  if (normalized < 0n) {
    throw new Error(`${fieldName} must be zero or greater.`);
  }
  return `0x${normalized.toString(16)}`;
}

function assertHexData(value, fieldName) {
  if (!/^0x([0-9a-fA-F]{2})*$/.test(value ?? "")) {
    throw new Error(`${fieldName} must be hex data.`);
  }
}

function assertHexAddress(value, fieldName) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value ?? "")) {
    throw new Error(`${fieldName} must be a 20-byte hex address.`);
  }
}

function normalizeTransactionRequest({ from, to, data, value } = {}) {
  assertHexAddress(to, "to");
  assertHexData(data, "data");

  const request = { to, data };
  if (from !== undefined) {
    assertHexAddress(from, "from");
    request.from = from;
  }
  if (value !== undefined) {
    request.value = bigintToHexQuantity(value, "value");
  }

  return request;
}

export function createJsonRpcClient({ rpcUrl, fetchFn = fetch } = {}) {
  if (!rpcUrl) {
    throw new Error("rpcUrl is required.");
  }

  let nextId = 1;

  async function request(method, params = []) {
    const id = nextId;
    nextId += 1;

    const response = await fetchFn(rpcUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params,
      }),
    });

    if (!response.ok) {
      throw new Error(`${method} failed with HTTP ${response.status}.`);
    }

    const payload = await response.json();
    if (payload.error) {
      throw new Error(`${method} failed: ${payload.error.message ?? "unknown RPC error"}`);
    }

    return payload.result;
  }

  async function requestBatch(requests = []) {
    if (requests.length === 0) return [];

    const envelopes = requests.map(({ method, params = [] }) => {
      const id = nextId;
      nextId += 1;
      return {
        jsonrpc: "2.0",
        id,
        method,
        params,
      };
    });

    const response = await fetchFn(rpcUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(envelopes),
    });

    if (!response.ok) {
      throw new Error(`JSON-RPC batch failed with HTTP ${response.status}.`);
    }

    const payload = await response.json();
    if (!Array.isArray(payload)) {
      throw new Error("JSON-RPC batch response must be an array.");
    }

    const responseById = new Map(payload.map((entry) => [entry.id, entry]));
    return envelopes.map((envelope) => {
      const entry = responseById.get(envelope.id);
      if (!entry) {
        throw new Error(`${envelope.method} failed: missing batch response for id ${envelope.id}.`);
      }
      if (entry.error) {
        throw new Error(`${envelope.method} failed: ${entry.error.message ?? "unknown RPC error"}`);
      }
      return entry.result;
    });
  }

  return {
    request,
    async getChainId() {
      return hexQuantityToNumber(await request("eth_chainId"), "eth_chainId");
    },
    async getGasPriceWei() {
      return hexQuantityToBigInt(await request("eth_gasPrice"), "eth_gasPrice");
    },
    async getBlockNumber() {
      return hexQuantityToBigInt(await request("eth_blockNumber"), "eth_blockNumber");
    },
    async getCode(address, blockTag = "latest") {
      assertHexAddress(address, "address");
      const bytecode = await request("eth_getCode", [address, blockTag]);
      assertHexData(bytecode, "eth_getCode result");
      return bytecode;
    },
    async getBalance(address, blockTag = "latest") {
      assertHexAddress(address, "address");
      return hexQuantityToBigInt(
        await request("eth_getBalance", [address, blockTag]),
        "eth_getBalance",
      );
    },
    async call(transaction, blockTag = "latest") {
      const result = await request("eth_call", [normalizeTransactionRequest(transaction), blockTag]);
      assertHexData(result, "eth_call result");
      return result;
    },
    async batchCall(transactions = [], blockTag = "latest") {
      const results = await requestBatch(
        transactions.map((transaction) => ({
          method: "eth_call",
          params: [normalizeTransactionRequest(transaction), blockTag],
        })),
      );
      for (const result of results) {
        assertHexData(result, "eth_call result");
      }
      return results;
    },
    async estimateGas(transaction) {
      return hexQuantityToBigInt(
        await request("eth_estimateGas", [normalizeTransactionRequest(transaction)]),
        "eth_estimateGas",
      );
    },
  };
}
