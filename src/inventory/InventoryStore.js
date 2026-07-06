/**
 * Real-time inventory store.
 *
 * The core correctness problem this solves: under concurrent order traffic,
 * a naive "read stock, check, decrement" sequence has a race window between
 * the check and the write. Two requests can both read stock=1, both think
 * they're allowed to buy it, and both decrement -> oversold inventory.
 *
 * Fix: reservation is done via a single Lua script executed atomically inside
 * Redis. Redis runs Lua scripts single-threaded and to completion, so the
 * check-then-decrement for an *entire multi-item order* happens as one
 * indivisible step, with no interleaving possible from other clients.
 *
 * The script is also all-or-nothing across every item in an order: if any
 * single SKU in a multi-item order has insufficient stock, NO stock is
 * decremented for ANY item in that order (avoids partial fulfillment).
 */

const RESERVE_SCRIPT = `
  -- KEYS = stock:{sku1}, stock:{sku2}, ...
  -- ARGV = qty1, qty2, ...
  local n = #KEYS
  for i = 1, n do
    local stock = tonumber(redis.call('GET', KEYS[i]) or '0')
    local requested = tonumber(ARGV[i])
    if stock < requested then
      return {0, KEYS[i]}  -- insufficient stock, abort with no writes at all
    end
  end
  for i = 1, n do
    redis.call('DECRBY', KEYS[i], tonumber(ARGV[i]))
  end
  return {1, ''}
`;

const RELEASE_SCRIPT = `
  -- Compensating transaction: give stock back (e.g. downstream payment failed)
  local n = #KEYS
  for i = 1, n do
    redis.call('INCRBY', KEYS[i], tonumber(ARGV[i]))
  end
  return 1
`;

class InventoryStore {
  constructor(redis) {
    this.redis = redis;
    this.redis.defineCommand('reserveStock', { numberOfKeys: null, lua: RESERVE_SCRIPT });
    this.redis.defineCommand('releaseStock', { numberOfKeys: null, lua: RELEASE_SCRIPT });
  }

  stockKey(sku) {
    return `stock:${sku}`;
  }

  async seedProduct(sku, name, quantity, price) {
    const multi = this.redis.multi();
    multi.set(this.stockKey(sku), quantity);
    multi.hset(`product:${sku}`, { sku, name, price: String(price) });
    await multi.exec();
  }

  async getStock(sku) {
    const val = await this.redis.get(this.stockKey(sku));
    return val === null ? null : parseInt(val, 10);
  }

  async getProduct(sku) {
    const product = await this.redis.hgetall(`product:${sku}`);
    if (!product || Object.keys(product).length === 0) return null;
    const stock = await this.getStock(sku);
    return { ...product, price: Number(product.price), stock };
  }

  async listProducts() {
    const keys = await this.redis.keys('product:*');
    const products = await Promise.all(keys.map((k) => this.getProduct(k.replace('product:', ''))));
    return products.filter(Boolean).sort((a, b) => a.sku.localeCompare(b.sku));
  }

  /**
   * Attempts to atomically reserve stock for every item in the order.
   * Returns { ok: true } on success (all items decremented),
   * or { ok: false, failedSku } if any single item had insufficient stock
   * (in which case NOTHING was decremented).
   */
  async reserve(items) {
    const keys = items.map((i) => this.stockKey(i.sku));
    const args = items.map((i) => String(i.quantity));
    const [ok, failedKey] = await this.redis.reserveStock(keys.length, ...keys, ...args);
    if (ok === 1) return { ok: true };
    return { ok: false, failedSku: failedKey.replace('stock:', '') };
  }

  /** Compensating transaction: put stock back for every item (used when a later saga step fails). */
  async release(items) {
    const keys = items.map((i) => this.stockKey(i.sku));
    const args = items.map((i) => String(i.quantity));
    await this.redis.releaseStock(keys.length, ...keys, ...args);
  }
}

module.exports = { InventoryStore };
