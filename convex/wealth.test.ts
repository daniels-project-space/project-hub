import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";

// Include _generated so convex-test findModulesRoot can locate the root.
const modules = import.meta.glob("./**/*.*s");
function t() {
  return convexTest(schema, modules);
}

describe("wealth.getWealth aggregation", () => {
  it("empty DB returns zeroed shape, not a crash", async () => {
    const c = t();
    const w = await c.query(api.wealth.getWealth, {});
    expect(w.totalGBP).toBe(0);
    expect(w.byCategory).toEqual({});
    expect(w.oldestPricedAt).toBeNull();
    expect(w.assetCount).toBe(0);
  });

  it("totalGBP = sum of lastValueGBP; byCategory groups + per-cat totals", async () => {
    const c = t();
    await c.mutation(api.wealth.upsertAsset, {
      category: "crypto", label: "BTC", lastValueGBP: 1000,
    });
    await c.mutation(api.wealth.upsertAsset, {
      category: "crypto", label: "ETH", lastValueGBP: 500,
    });
    await c.mutation(api.wealth.upsertAsset, {
      category: "cash", label: "GBP cash", lastValueGBP: 250,
    });
    const w = await c.query(api.wealth.getWealth, {});
    expect(w.totalGBP).toBe(1750);
    expect(w.assetCount).toBe(3);
    expect(w.byCategory.crypto.total).toBe(1500);
    expect(w.byCategory.cash.total).toBe(250);
    expect(w.byCategory.crypto.assets.map((a: any) => a.label).sort()).toEqual(["BTC", "ETH"]);
  });

  it("assets with no lastValueGBP count as 0 (null surfaced, not NaN)", async () => {
    const c = t();
    await c.mutation(api.wealth.upsertAsset, { category: "gold", label: "unpriced" });
    await c.mutation(api.wealth.upsertAsset, {
      category: "gold", label: "priced", lastValueGBP: 300,
    });
    const w = await c.query(api.wealth.getWealth, {});
    expect(w.totalGBP).toBe(300);
    const unpriced = w.byCategory.gold.assets.find((a: any) => a.label === "unpriced");
    expect(unpriced.lastValueGBP).toBeNull();
    expect(unpriced.lastPricedAt).toBeNull();
    expect(Number.isNaN(w.totalGBP)).toBe(false);
  });

  it("oldestPricedAt = MIN lastPricedAt across priced assets; ignores unpriced", async () => {
    const c = t();
    // upsertAsset only stamps lastPricedAt when lastValueGBP is provided,
    // so use the internal auto-upsert with explicit pricedAt for control.
    await c.mutation(internal.wealth._upsertAutoAsset, {
      category: "crypto", label: "old", currency: "GBP",
      newValueGBP: 100, pricedAt: 1000,
    });
    await c.mutation(internal.wealth._upsertAutoAsset, {
      category: "crypto", label: "new", currency: "GBP",
      newValueGBP: 200, pricedAt: 9000,
    });
    // an unpriced asset must NOT drag oldestPricedAt
    await c.mutation(api.wealth.upsertAsset, { category: "gold", label: "noprice" });
    const w = await c.query(api.wealth.getWealth, {});
    expect(w.oldestPricedAt).toBe(1000);
    expect(w.totalGBP).toBe(300);
  });
});

describe("manual upsertAsset / removeAsset", () => {
  it("insert then patch by id (no duplicate row)", async () => {
    const c = t();
    const id = await c.mutation(api.wealth.upsertAsset, {
      category: "property", label: "Flat", lastValueGBP: 200000,
    });
    await c.mutation(api.wealth.upsertAsset, {
      id, category: "property", label: "Flat", lastValueGBP: 210000,
    });
    const w = await c.query(api.wealth.getWealth, {});
    expect(w.assetCount).toBe(1);
    expect(w.totalGBP).toBe(210000);
  });

  it("defaults currency to GBP; source is 'manual'", async () => {
    const c = t();
    await c.mutation(api.wealth.upsertAsset, {
      category: "cash", label: "wallet", lastValueGBP: 40,
    });
    const w = await c.query(api.wealth.getWealth, {});
    const a = w.byCategory.cash.assets[0];
    expect(a.currency).toBe("GBP");
    expect(a.source).toBe("manual");
  });

  it("removeAsset deletes; getWealth reflects removal", async () => {
    const c = t();
    const id = await c.mutation(api.wealth.upsertAsset, {
      category: "stocks", label: "AAPL", lastValueGBP: 999,
    });
    await c.mutation(api.wealth.removeAsset, { id });
    const w = await c.query(api.wealth.getWealth, {});
    expect(w.assetCount).toBe(0);
    expect(w.totalGBP).toBe(0);
  });

  it("EDGE: huge 1e15 value aggregates without overflow corruption", async () => {
    const c = t();
    await c.mutation(api.wealth.upsertAsset, {
      category: "inventory", label: "whale", lastValueGBP: 1e15,
    });
    const w = await c.query(api.wealth.getWealth, {});
    expect(w.totalGBP).toBe(1e15);
  });

  it("EDGE: negative value (debt-like) is summed, not clamped", async () => {
    const c = t();
    await c.mutation(api.wealth.upsertAsset, { category: "cash", label: "pos", lastValueGBP: 100 });
    await c.mutation(api.wealth.upsertAsset, { category: "cash", label: "neg", lastValueGBP: -30 });
    const w = await c.query(api.wealth.getWealth, {});
    expect(w.totalGBP).toBe(70);
  });
});

describe("anti-staleness contract: _upsertAutoAsset", () => {
  it("keeps previous value + lastPricedAt when newValueGBP is ABSENT", async () => {
    const c = t();
    // First fresh price.
    await c.mutation(internal.wealth._upsertAutoAsset, {
      category: "crypto", label: "BTC", currency: "GBP",
      newValueGBP: 50000, pricedAt: 1234,
    });
    let w = await c.query(api.wealth.getWealth, {});
    let btc = w.byCategory.crypto.assets.find((a: any) => a.label === "BTC");
    expect(btc.lastValueGBP).toBe(50000);
    expect(btc.lastPricedAt).toBe(1234);

    // Second upsert WITHOUT a value (API failed) — must NOT clobber.
    await c.mutation(internal.wealth._upsertAutoAsset, {
      category: "crypto", label: "BTC", currency: "GBP",
      quantity: 1.5, // metadata updates fine, but value must persist
    });
    w = await c.query(api.wealth.getWealth, {});
    btc = w.byCategory.crypto.assets.find((a: any) => a.label === "BTC");
    expect(btc.lastValueGBP).toBe(50000); // PRESERVED
    expect(btc.lastPricedAt).toBe(1234);  // PRESERVED
    expect(btc.quantity).toBe(1.5);       // metadata still updated
  });

  it("brand-new auto asset with NO value inserts as unpriced (null/null)", async () => {
    const c = t();
    await c.mutation(internal.wealth._upsertAutoAsset, {
      category: "stocks", label: "TSLA", currency: "GBP",
    });
    const w = await c.query(api.wealth.getWealth, {});
    const tsla = w.byCategory.stocks.assets.find((a: any) => a.label === "TSLA");
    expect(tsla.lastValueGBP).toBeNull();
    expect(tsla.lastPricedAt).toBeNull();
  });

  it("fresh value DOES overwrite previous (positive case for the guard)", async () => {
    const c = t();
    await c.mutation(internal.wealth._upsertAutoAsset, {
      category: "crypto", label: "ETH", currency: "GBP",
      newValueGBP: 100, pricedAt: 1,
    });
    await c.mutation(internal.wealth._upsertAutoAsset, {
      category: "crypto", label: "ETH", currency: "GBP",
      newValueGBP: 999, pricedAt: 2,
    });
    const w = await c.query(api.wealth.getWealth, {});
    const eth = w.byCategory.crypto.assets.find((a: any) => a.label === "ETH");
    expect(eth.lastValueGBP).toBe(999);
    expect(eth.lastPricedAt).toBe(2);
  });

  it("auto upsert keys on (category,label,source=auto): no dup, manual sibling untouched", async () => {
    const c = t();
    // manual BTC and auto BTC must coexist as separate rows.
    await c.mutation(api.wealth.upsertAsset, {
      category: "crypto", label: "BTC", lastValueGBP: 10,
    });
    await c.mutation(internal.wealth._upsertAutoAsset, {
      category: "crypto", label: "BTC", currency: "GBP", newValueGBP: 20, pricedAt: 5,
    });
    await c.mutation(internal.wealth._upsertAutoAsset, {
      category: "crypto", label: "BTC", currency: "GBP", newValueGBP: 30, pricedAt: 6,
    });
    const w = await c.query(api.wealth.getWealth, {});
    expect(w.byCategory.crypto.assets).toHaveLength(2); // 1 manual + 1 auto
    expect(w.totalGBP).toBe(40); // 10 manual + 30 auto (auto updated in place)
  });
});
