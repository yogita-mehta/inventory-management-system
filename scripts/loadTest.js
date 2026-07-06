require('dotenv').config();
const { createClient } = require('../src/config/redis');
const { OrderStore } = require('../src/orders/OrderStore');
const { EventBus } = require('../src/events/EventBus');

const NORMAL_SKUS = ['SKU-LAPTOP-01', 'SKU-PHONE-01', 'SKU-HEADPHONE-01', 'SKU-WATCH-01'];
const ORDERS_STREAM = 'events:orders';
const TOTAL_ORDERS = Number(process.argv[2]) || 500;

async function main() {
  const redis = createClient('load-test');
  const orders = new OrderStore(redis);
  const bus = new EventBus(redis);

  console.log(`\n=== Inventory System — Normal Load Test ===`);
  console.log(`Placing ${TOTAL_ORDERS} orders across ${NORMAL_SKUS.length} well-stocked SKUs...\n`);

  const startPlace = Date.now();
  for (let i = 0; i < TOTAL_ORDERS; i++) {
    const sku = NORMAL_SKUS[Math.floor(Math.random() * NORMAL_SKUS.length)];
    const quantity = 1 + Math.floor(Math.random() * 3);
    const orderId = await orders.create([{ sku, quantity }]);
    await bus.publish(ORDERS_STREAM, { orderId, items: [{ sku, quantity }], type: 'ORDER_PLACED' });
  }
  const placeDuration = Date.now() - startPlace;
  console.log(`Placed ${TOTAL_ORDERS} orders in ${placeDuration}ms.`);
  console.log(`Waiting for inventory-worker + order-worker to drain the pipeline...\n`);

  const startProcessing = Date.now();
  const TIMEOUT_MS = 120000;
  let lastReport = 0;

  while (Date.now() - startProcessing < TIMEOUT_MS) {
    const stats = await orders.getStats();
    const settled = stats.confirmed + stats.rejected + stats.cancelled;

    if (Date.now() - lastReport > 1500) {
      process.stdout.write(
        `\r  placed: ${stats.placed} | reserved(in-flight): ${stats.reserved} | confirmed: ${stats.confirmed} | rejected: ${stats.rejected} | cancelled: ${stats.cancelled}   `
      );
      lastReport = Date.now();
    }

    if (settled >= TOTAL_ORDERS) break;
    await new Promise((r) => setTimeout(r, 300));
  }

  const totalDuration = Date.now() - startProcessing;
  const finalStats = await orders.getStats();
  const throughput = ((finalStats.confirmed + finalStats.cancelled) / (totalDuration / 1000)).toFixed(2);

  console.log(`\n\n=== Results ===`);
  console.log(`Total orders placed  : ${TOTAL_ORDERS}`);
  console.log(`Total processing time: ${(totalDuration / 1000).toFixed(2)}s`);
  console.log(`Confirmed            : ${finalStats.confirmed}`);
  console.log(`Cancelled (payment)  : ${finalStats.cancelled}`);
  console.log(`Rejected (OOS)       : ${finalStats.rejected}`);
  console.log(`Order throughput     : ${throughput} orders/sec`);
  console.log(`\nReal numbers from this run.\n`);

  process.exit(0);
}

main().catch((err) => {
  console.error('Load test failed:', err);
  process.exit(1);
});
