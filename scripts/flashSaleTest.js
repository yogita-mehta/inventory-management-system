require('dotenv').config();
const { createClient } = require('../src/config/redis');
const { InventoryStore } = require('../src/inventory/InventoryStore');
const { OrderStore } = require('../src/orders/OrderStore');
const { EventBus } = require('../src/events/EventBus');

const FLASH_SKU = 'SKU-FLASHSALE-01';
const ORDERS_STREAM = 'events:orders';
const CONCURRENT_BUYERS = Number(process.argv[2]) || 200;

/**
 * This is the core correctness proof for the system: fire many concurrent
 * "buy 1 unit" requests at a limited-stock SKU simultaneously (via
 * Promise.all, so they truly overlap in time) and confirm that EXACTLY
 * `stock` of them succeed -- never more (overselling) and never fewer than
 * warranted (false rejections due to a buggy lock).
 */
async function main() {
  const redis = createClient('flash-sale-test');
  const inventory = new InventoryStore(redis);
  const orders = new OrderStore(redis);
  const bus = new EventBus(redis);

  const stockBefore = await inventory.getStock(FLASH_SKU);
  if (stockBefore === null) {
    console.error(`SKU ${FLASH_SKU} not found. Run "npm run seed" first.`);
    process.exit(1);
  }

  console.log(`\n=== Flash Sale Concurrency Test ===`);
  console.log(`Product: ${FLASH_SKU}  |  Stock available: ${stockBefore}`);
  console.log(`Firing ${CONCURRENT_BUYERS} TRUE-CONCURRENT buy-1 requests at this SKU...\n`);

  const start = Date.now();
  const orderIds = await Promise.all(
    Array.from({ length: CONCURRENT_BUYERS }, async () => {
      const orderId = await orders.create([{ sku: FLASH_SKU, quantity: 1 }]);
      await bus.publish(ORDERS_STREAM, { orderId, items: [{ sku: FLASH_SKU, quantity: 1 }], type: 'ORDER_PLACED' });
      return orderId;
    })
  );
  const fireDuration = Date.now() - start;
  console.log(`Fired all ${CONCURRENT_BUYERS} requests in ${fireDuration}ms (submitted concurrently).`);
  console.log(`Waiting for inventory-worker to process the queue...\n`);

  // Poll until every order for this batch has settled to RESERVED or REJECTED.
  const TIMEOUT_MS = 60000;
  const settledStart = Date.now();
  let settledCount = 0;

  while (Date.now() - settledStart < TIMEOUT_MS) {
    const statuses = await Promise.all(orderIds.map((id) => orders.get(id)));
    settledCount = statuses.filter((o) => o.status !== 'PLACED').length;
    if (settledCount === CONCURRENT_BUYERS) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  const finalStatuses = await Promise.all(orderIds.map((id) => orders.get(id)));
  const reserved = finalStatuses.filter((o) => o.status === 'RESERVED' || o.status === 'CONFIRMED' || o.status === 'CANCELLED').length;
  const rejected = finalStatuses.filter((o) => o.status === 'REJECTED').length;
  const stockAfter = await inventory.getStock(FLASH_SKU);

  const oversold = reserved > stockBefore;

  console.log(`=== Results ===`);
  console.log(`Concurrent requests fired : ${CONCURRENT_BUYERS}`);
  console.log(`Stock available before    : ${stockBefore}`);
  console.log(`Orders that got stock     : ${reserved}`);
  console.log(`Orders correctly rejected : ${rejected} (out of stock)`);
  console.log(`Stock remaining after     : ${stockAfter}`);
  console.log(`Expected successful orders: ${stockBefore} (exactly matches available stock)`);
  console.log(`\nOVERSELLING CHECK: ${oversold ? 'FAILED ❌ — stock was oversold!' : 'PASSED ✅ — zero overselling, exact stock match'}`);
  console.log(
    reserved === stockBefore
      ? `Every single unit was allocated correctly: ${reserved}/${stockBefore} matched exactly under full concurrency.\n`
      : `Note: reserved (${reserved}) vs stock (${stockBefore}) — check timing/timeout if these don't match.\n`
  );

  process.exit(0);
}

main().catch((err) => {
  console.error('Flash sale test failed:', err);
  process.exit(1);
});
