import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.*s");
const ROOT_TOKEN = "root-capability-".padEnd(40, "r");
const WRITER_TOKEN = "cj-writer-capability-".padEnd(40, "w");

type Bundle = {
  CJ_OPEN_ID: string;
  CJ_ACCESS_TOKEN: string;
  CJ_REFRESH_TOKEN: string;
  CJ_ACCESS_TOKEN_EXPIRY_DATE?: string;
  CJ_REFRESH_TOKEN_EXPIRY_DATE?: string;
};

function t(enforceAuth = "false") {
  vi.stubEnv("VAULT_ENFORCE_AUTH", enforceAuth);
  vi.stubEnv("VAULT_ROOT_TOKEN", ROOT_TOKEN);
  return convexTest(schema, modules);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function nextBundle(label: string, expiries = true): Bundle {
  return {
    CJ_OPEN_ID: "000123456789",
    CJ_ACCESS_TOKEN: `access-${label}`,
    CJ_REFRESH_TOKEN: `refresh-${label}`,
    ...(expiries
      ? {
          CJ_ACCESS_TOKEN_EXPIRY_DATE: `access-expiry-${label}`,
          CJ_REFRESH_TOKEN_EXPIRY_DATE: `refresh-expiry-${label}`,
        }
      : {}),
  };
}

async function addWriter(c: ReturnType<typeof t>, token = WRITER_TOKEN) {
  await c.mutation(api.vaultAuth.upsertClient, {
    rootToken: ROOT_TOKEN,
    name: `client-${token.slice(-4)}`,
    token,
    services: ["cj"],
    canWrite: true,
  });
}

async function insertClient(
  c: ReturnType<typeof t>,
  row: {
    name: string;
    token: string;
    services: string[];
    active?: boolean;
    canWrite?: boolean;
  },
) {
  await c.run(async (ctx) => {
    await ctx.db.insert("vaultClients", {
      name: row.name,
      token: row.token,
      services: row.services,
      active: row.active ?? true,
      canWrite: row.canWrite ?? true,
      createdAt: 1,
      updatedAt: 1,
    });
  });
}

async function insertSecret(
  c: ReturnType<typeof t>,
  keyName: string,
  value: string,
  metadata?: {
    description?: string;
    scopes?: string[];
    aliases?: string[];
    sourceFiles?: string[];
  },
) {
  await c.run(async (ctx) => {
    await ctx.db.insert("secrets", {
      service: "cj",
      keyName,
      value,
      description: metadata?.description,
      scopes: metadata?.scopes ?? ["historical-scope"],
      aliases: metadata?.aliases ?? [`alias-${keyName}`],
      sourceFiles: metadata?.sourceFiles ?? [`source-${keyName}`],
    });
  });
}

async function seedBundle(
  c: ReturnType<typeof t>,
  bundle: Bundle,
  metadata?: Parameters<typeof insertSecret>[3],
) {
  for (const [key, value] of Object.entries(bundle)) {
    await insertSecret(c, key, value, metadata);
  }
}

async function cjRows(c: ReturnType<typeof t>) {
  return await c.run(async (ctx) => {
    const rows = await ctx.db
      .query("secrets")
      .withIndex("by_service", (q) => q.eq("service", "cj"))
      .collect();
    return rows.sort((left, right) => left.keyName.localeCompare(right.keyName));
  });
}

function expectSafeOutput(output: unknown, forbidden: string[]) {
  const serialized = JSON.stringify(output);
  for (const fragment of forbidden) expect(serialized).not.toContain(fragment);
  expect(serialized).not.toMatch(/(?:access|refresh)-(?:old|new|current|winner|loser)/);
}

describe("CJ token-bundle strict authorization", () => {
  it("rejects every non-exact writer case even when rollout enforcement is disabled", async () => {
    const c = t("false");
    const inactive = "inactive-client-".padEnd(40, "i");
    const readOnly = "readonly-client-".padEnd(40, "o");
    const wrongService = "wrong-service-client-".padEnd(40, "s");
    const wildcard = "wildcard-client-".padEnd(40, "x");
    const prefix = "prefix-client-".padEnd(40, "p");
    const mixedWildcard = "mixed-wildcard-client-".padEnd(40, "m");
    const duplicatePolicy = "duplicate-policy-client-".padEnd(40, "d");
    const duplicateClient = "duplicate-client-".padEnd(40, "u");

    await insertClient(c, { name: "inactive", token: inactive, services: ["cj"], active: false });
    await insertClient(c, { name: "read-only", token: readOnly, services: ["cj"], canWrite: false });
    await insertClient(c, { name: "wrong-service", token: wrongService, services: ["dropship"] });
    await insertClient(c, { name: "wildcard", token: wildcard, services: ["*"] });
    await insertClient(c, { name: "prefix", token: prefix, services: ["c*"] });
    await insertClient(c, { name: "mixed-wildcard", token: mixedWildcard, services: ["cj", "*"] });
    await insertClient(c, { name: "duplicate-policy", token: duplicatePolicy, services: ["cj", "cj"] });
    await insertClient(c, { name: "duplicate-one", token: duplicateClient, services: ["cj"] });
    await insertClient(c, { name: "duplicate-two", token: duplicateClient, services: ["cj"] });

    const rejectedTokens = [
      undefined,
      "short",
      inactive,
      readOnly,
      wrongService,
      wildcard,
      prefix,
      mixedWildcard,
      duplicatePolicy,
      duplicateClient,
    ];
    for (const vaultToken of rejectedTokens) {
      await expect(
        c.query(api.secrets.preflightCjTokenBundle, {
          service: "cj",
          vaultToken,
        }),
      ).rejects.toThrow("Vault authentication required");
    }
  });

  it("accepts the root capability and one unique exact-service writer", async () => {
    const c = t("false");
    await addWriter(c);

    await expect(
      c.query(api.secrets.preflightCjTokenBundle, {
        service: "cj",
        vaultToken: ROOT_TOKEN,
      }),
    ).resolves.toEqual({ status: "ready", retainedKeys: [] });
    await expect(
      c.query(api.secrets.preflightCjTokenBundle, {
        service: "cj",
        vaultToken: WRITER_TOKEN,
      }),
    ).resolves.toEqual({ status: "ready", retainedKeys: [] });
  });
});

describe("CJ token-bundle readiness and atomic CAS", () => {
  it("supports a clean first connection while preserving the digit-string openId", async () => {
    const c = t();
    await addWriter(c);
    const bundle = nextBundle("initial", false);

    expect(
      await c.query(api.secrets.preflightCjTokenBundle, {
        service: "cj",
        vaultToken: WRITER_TOKEN,
      }),
    ).toEqual({ status: "ready", retainedKeys: [] });
    expect(
      await c.mutation(api.secrets.compareAndSwapCjTokenBundle, {
        service: "cj",
        vaultToken: WRITER_TOKEN,
        bundle,
      }),
    ).toEqual({
      status: "written",
      retainedKeys: ["CJ_OPEN_ID", "CJ_ACCESS_TOKEN", "CJ_REFRESH_TOKEN"],
    });

    const rows = await cjRows(c);
    expect(Object.fromEntries(rows.map((row) => [row.keyName, row.value]))).toEqual(bundle);
    expect(rows.find((row) => row.keyName === "CJ_OPEN_ID")?.value).toBe("000123456789");
    expect(rows.every((row) => row.scopes.join() === "cj")).toBe(true);
    expect(rows.every((row) => row.aliases.length === 0 && row.sourceFiles.length === 0)).toBe(true);
    await expect(
      c.mutation(api.secrets.compareAndSwapCjTokenBundle, {
        service: "cj",
        vaultToken: WRITER_TOKEN,
        bundle,
      }),
    ).resolves.toEqual({ status: "conflict" });
    expect(await cjRows(c)).toEqual(rows);
  });

  it("requires an absent expectation only when no refresh row exists", async () => {
    const c = t();
    await addWriter(c);

    await expect(
      c.query(api.secrets.preflightCjTokenBundle, {
        service: "cj",
        vaultToken: WRITER_TOKEN,
        expectedRefreshToken: "unexpected-current",
      }),
    ).resolves.toEqual({ status: "conflict", retainedKeys: [] });
    await expect(
      c.mutation(api.secrets.compareAndSwapCjTokenBundle, {
        service: "cj",
        vaultToken: WRITER_TOKEN,
        expectedRefreshToken: "unexpected-current",
        bundle: nextBundle("initial"),
      }),
    ).resolves.toEqual({ status: "conflict" });
    expect(await cjRows(c)).toEqual([]);
  });

  it("rotates all five keys together after a matching preflight", async () => {
    const c = t();
    await addWriter(c);
    const oldBundle = nextBundle("old");
    const newBundle = nextBundle("new");
    await seedBundle(c, oldBundle);

    expect(
      await c.query(api.secrets.preflightCjTokenBundle, {
        service: "cj",
        vaultToken: WRITER_TOKEN,
        expectedRefreshToken: oldBundle.CJ_REFRESH_TOKEN,
      }),
    ).toEqual({ status: "ready", retainedKeys: Object.keys(oldBundle) });
    expect(
      await c.mutation(api.secrets.compareAndSwapCjTokenBundle, {
        service: "cj",
        vaultToken: WRITER_TOKEN,
        expectedRefreshToken: oldBundle.CJ_REFRESH_TOKEN,
        bundle: newBundle,
      }),
    ).toEqual({ status: "written", retainedKeys: Object.keys(newBundle) });
    expect(Object.fromEntries((await cjRows(c)).map((row) => [row.keyName, row.value]))).toEqual(
      newBundle,
    );
  });

  it("removes stale optional expiries omitted by the replacement", async () => {
    const c = t();
    await addWriter(c);
    const oldBundle = nextBundle("old");
    const newBundle = nextBundle("new", false);
    await seedBundle(c, oldBundle);

    await c.mutation(api.secrets.compareAndSwapCjTokenBundle, {
      service: "cj",
      vaultToken: WRITER_TOKEN,
      expectedRefreshToken: oldBundle.CJ_REFRESH_TOKEN,
      bundle: newBundle,
    });

    const rows = await cjRows(c);
    expect(rows.map((row) => row.keyName).sort()).toEqual(Object.keys(newBundle).sort());
    expect(rows.some((row) => row.keyName.includes("EXPIRY"))).toBe(false);
  });

  it("preserves every non-secret metadata field and row id on updates", async () => {
    const c = t();
    await addWriter(c);
    const oldBundle = nextBundle("old");
    await seedBundle(c, oldBundle, {
      description: "kept description",
      scopes: ["kept-scope"],
      aliases: ["kept-alias"],
      sourceFiles: ["kept-source"],
    });
    const before = await cjRows(c);

    await c.mutation(api.secrets.compareAndSwapCjTokenBundle, {
      service: "cj",
      vaultToken: WRITER_TOKEN,
      expectedRefreshToken: oldBundle.CJ_REFRESH_TOKEN,
      bundle: nextBundle("new"),
    });

    const after = await cjRows(c);
    for (const row of after) {
      const prior = before.find((candidate) => candidate.keyName === row.keyName);
      expect(row._id).toBe(prior?._id);
      expect({
        description: row.description,
        scopes: row.scopes,
        aliases: row.aliases,
        sourceFiles: row.sourceFiles,
      }).toEqual({
        description: "kept description",
        scopes: ["kept-scope"],
        aliases: ["kept-alias"],
        sourceFiles: ["kept-source"],
      });
    }
  });

  it("returns conflict and preserves source rows byte-for-byte for a stale writer", async () => {
    const c = t();
    await addWriter(c);
    await seedBundle(c, nextBundle("current"), { sourceFiles: ["preserve/byte-for-byte"] });
    const before = await cjRows(c);

    expect(
      await c.mutation(api.secrets.compareAndSwapCjTokenBundle, {
        service: "cj",
        vaultToken: WRITER_TOKEN,
        expectedRefreshToken: "refresh-stale",
        bundle: nextBundle("new"),
      }),
    ).toEqual({ status: "conflict" });
    expect(await cjRows(c)).toEqual(before);
  });

  it("rejects malformed bundle fields without any partial write", async () => {
    const c = t();
    await addWriter(c);
    const oldBundle = nextBundle("current");
    await seedBundle(c, oldBundle);
    const before = await cjRows(c);
    const valid = nextBundle("new");
    const malformed: Bundle[] = [
      { ...valid, CJ_OPEN_ID: " 123" },
      { ...valid, CJ_OPEN_ID: "1".repeat(21) },
      { ...valid, CJ_ACCESS_TOKEN: "" },
      { ...valid, CJ_REFRESH_TOKEN: "   " },
      { ...valid, CJ_ACCESS_TOKEN: "a".repeat(4097) },
      { ...valid, CJ_ACCESS_TOKEN_EXPIRY_DATE: "" },
      { ...valid, CJ_REFRESH_TOKEN_EXPIRY_DATE: "e".repeat(129) },
    ];

    for (const bundle of malformed) {
      await expect(
        c.mutation(api.secrets.compareAndSwapCjTokenBundle, {
          service: "cj",
          vaultToken: WRITER_TOKEN,
          expectedRefreshToken: oldBundle.CJ_REFRESH_TOKEN,
          bundle,
        }),
      ).rejects.toThrow("Invalid CJ token bundle");
      expect(await cjRows(c)).toEqual(before);
    }

    await expect(
      c.mutation(api.secrets.compareAndSwapCjTokenBundle, {
        service: "dropship",
        vaultToken: WRITER_TOKEN,
        expectedRefreshToken: oldBundle.CJ_REFRESH_TOKEN,
        bundle: valid,
      } as never),
    ).rejects.toThrow();
    await expect(
      c.mutation(api.secrets.compareAndSwapCjTokenBundle, {
        service: "cj",
        vaultToken: WRITER_TOKEN,
        expectedRefreshToken: oldBundle.CJ_REFRESH_TOKEN,
        bundle: { ...valid, CJ_UNKNOWN_TOKEN: "not-accepted" },
      } as never),
    ).rejects.toThrow();
    expect(await cjRows(c)).toEqual(before);
  });

  it("fails closed on incomplete or duplicate required rows", async () => {
    const c = t();
    await addWriter(c);
    await insertSecret(c, "CJ_OPEN_ID", "123");
    await insertSecret(c, "CJ_OPEN_ID", "456");
    await insertSecret(c, "CJ_ACCESS_TOKEN", "access-current");
    await insertSecret(c, "CJ_REFRESH_TOKEN", "refresh-current");
    const before = await cjRows(c);

    expect(
      await c.query(api.secrets.preflightCjTokenBundle, {
        service: "cj",
        vaultToken: WRITER_TOKEN,
        expectedRefreshToken: "refresh-current",
      }),
    ).toEqual({
      status: "ambiguous",
      retainedKeys: ["CJ_OPEN_ID", "CJ_ACCESS_TOKEN", "CJ_REFRESH_TOKEN"],
    });
    expect(
      await c.mutation(api.secrets.compareAndSwapCjTokenBundle, {
        service: "cj",
        vaultToken: WRITER_TOKEN,
        expectedRefreshToken: "refresh-current",
        bundle: nextBundle("new"),
      }),
    ).toEqual({ status: "ambiguous" });
    expect(await cjRows(c)).toEqual(before);
  });

  it("fails closed on unique but incomplete or malformed historical bundles", async () => {
    const incomplete = t();
    await addWriter(incomplete);
    await insertSecret(incomplete, "CJ_OPEN_ID", "123");
    await insertSecret(incomplete, "CJ_REFRESH_TOKEN", "refresh-current");
    await expect(
      incomplete.query(api.secrets.preflightCjTokenBundle, {
        service: "cj",
        vaultToken: WRITER_TOKEN,
        expectedRefreshToken: "refresh-current",
      }),
    ).resolves.toMatchObject({ status: "ambiguous" });

    const malformed = t();
    await addWriter(malformed);
    await seedBundle(malformed, { ...nextBundle("current"), CJ_OPEN_ID: "not-digits" });
    const before = await cjRows(malformed);
    await expect(
      malformed.mutation(api.secrets.compareAndSwapCjTokenBundle, {
        service: "cj",
        vaultToken: WRITER_TOKEN,
        expectedRefreshToken: "refresh-current",
        bundle: nextBundle("new"),
      }),
    ).resolves.toEqual({ status: "ambiguous" });
    expect(await cjRows(malformed)).toEqual(before);
  });

  it("fails closed on duplicate optional rows with zero writes", async () => {
    const c = t();
    await addWriter(c);
    const oldBundle = nextBundle("current");
    await seedBundle(c, oldBundle);
    await insertSecret(c, "CJ_ACCESS_TOKEN_EXPIRY_DATE", "duplicate-expiry");
    const before = await cjRows(c);

    expect(
      await c.query(api.secrets.preflightCjTokenBundle, {
        service: "cj",
        vaultToken: WRITER_TOKEN,
        expectedRefreshToken: oldBundle.CJ_REFRESH_TOKEN,
      }),
    ).toMatchObject({ status: "ambiguous" });
    expect(
      await c.mutation(api.secrets.compareAndSwapCjTokenBundle, {
        service: "cj",
        vaultToken: WRITER_TOKEN,
        expectedRefreshToken: oldBundle.CJ_REFRESH_TOKEN,
        bundle: nextBundle("new"),
      }),
    ).toEqual({ status: "ambiguous" });
    expect(await cjRows(c)).toEqual(before);
  });

  it("makes response-loss replay idempotent but conflicts a changed replay payload", async () => {
    const c = t();
    await addWriter(c);
    const oldBundle = nextBundle("old");
    const newBundle = nextBundle("new");
    await seedBundle(c, oldBundle);
    const args = {
      service: "cj" as const,
      vaultToken: WRITER_TOKEN,
      expectedRefreshToken: oldBundle.CJ_REFRESH_TOKEN,
      bundle: newBundle,
    };

    expect(await c.mutation(api.secrets.compareAndSwapCjTokenBundle, args)).toMatchObject({
      status: "written",
    });
    const afterWrite = await cjRows(c);
    expect(await c.mutation(api.secrets.compareAndSwapCjTokenBundle, args)).toMatchObject({
      status: "written",
    });
    expect(await cjRows(c)).toEqual(afterWrite);

    expect(
      await c.mutation(api.secrets.compareAndSwapCjTokenBundle, {
        ...args,
        bundle: { ...newBundle, CJ_ACCESS_TOKEN: "changed-replay-payload" },
      }),
    ).toEqual({ status: "conflict" });
    expect(await cjRows(c)).toEqual(afterWrite);
  });

  it("concurrent stale writers converge to one complete winner and one conflict", async () => {
    const c = t();
    await addWriter(c);
    const current = nextBundle("current");
    const candidates = [nextBundle("winner-a"), nextBundle("winner-b")];
    await seedBundle(c, current);

    const results = await Promise.all(
      candidates.map((bundle) =>
        c.mutation(api.secrets.compareAndSwapCjTokenBundle, {
          service: "cj",
          vaultToken: WRITER_TOKEN,
          expectedRefreshToken: current.CJ_REFRESH_TOKEN,
          bundle,
        }),
      ),
    );
    expect(results.map((result) => result.status).sort()).toEqual(["conflict", "written"]);

    const durable = Object.fromEntries((await cjRows(c)).map((row) => [row.keyName, row.value]));
    const winnerIndex = results.findIndex((result) => result.status === "written");
    const loserIndex = winnerIndex === 0 ? 1 : 0;
    expect(durable).toEqual(candidates[winnerIndex]);
    expect(
      await c.mutation(api.secrets.compareAndSwapCjTokenBundle, {
        service: "cj",
        vaultToken: WRITER_TOKEN,
        expectedRefreshToken: current.CJ_REFRESH_TOKEN,
        bundle: candidates[loserIndex],
      }),
    ).toEqual({ status: "conflict" });
    expect(Object.fromEntries((await cjRows(c)).map((row) => [row.keyName, row.value]))).toEqual(
      candidates[winnerIndex],
    );
  });

  it("returns and logs only status plus retained key names", async () => {
    const c = t();
    await addWriter(c);
    const oldBundle = nextBundle("old");
    const newBundle = nextBundle("new");
    await seedBundle(c, oldBundle);
    const spies = [
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined),
    ];

    const ready = await c.query(api.secrets.preflightCjTokenBundle, {
      service: "cj",
      vaultToken: WRITER_TOKEN,
      expectedRefreshToken: oldBundle.CJ_REFRESH_TOKEN,
    });
    const conflict = await c.query(api.secrets.preflightCjTokenBundle, {
      service: "cj",
      vaultToken: WRITER_TOKEN,
      expectedRefreshToken: "wrong-expected-value",
    });
    const written = await c.mutation(api.secrets.compareAndSwapCjTokenBundle, {
      service: "cj",
      vaultToken: WRITER_TOKEN,
      expectedRefreshToken: oldBundle.CJ_REFRESH_TOKEN,
      bundle: newBundle,
    });
    const forbidden = [
      WRITER_TOKEN,
      ...Object.values(oldBundle),
      ...Object.values(newBundle),
      "wrong-expected-value",
    ];
    expectSafeOutput([ready, conflict, written], forbidden);
    expect(ready).toEqual({ status: "ready", retainedKeys: Object.keys(oldBundle) });
    expect(conflict).toEqual({ status: "conflict", retainedKeys: Object.keys(oldBundle) });
    expect(written).toEqual({ status: "written", retainedKeys: Object.keys(newBundle) });

    const logged = spies.flatMap((spy) => spy.mock.calls).flat();
    expectSafeOutput(logged, forbidden);
    expect(logged).toEqual([]);
  });
});
