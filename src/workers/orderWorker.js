require('dotenv').config();
const { createClient } = require('../config/redis');
const { InventoryStore } = require('../inventory/InventoryStore');
const { OrderStore } = require('../orders/OrderStore');
const { EventBus } = require('../events/EventBus');

const INVENTORY_STREAM = 'events:inventory';
const GROUP = 'order-service';
const CONSUMER_NAME = `order-worker-${process.pid}`;
const PAYMENT_FAILURE_RATE = Number(process.env.PAYMENT_FAILURE_RATE || 0.1);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Simulated downstream payment call. */
async function attemptPayment() {
  await sleep(20 + Math.random() * 60);
  return Math.random() >= PAYMENT_FAILURE_RATE;
}

async function main() {
  const redis = createClient(CONSUMER_NAME);
  const inventory = new InventoryStore(redis);
  const orders = new OrderStore(redis);
  const bus = new EventBus(redis);

  await bus.ensureGroup(INVENTORY_STREAM, GROUP);
  console.log(`[${CONSUMER_NAME}] consuming "${INVENTORY_STREAM}" as group "${GROUP}"`);

  while (true) {
    const events = await bus.consume(INVENTORY_STREAM, GROUP, CONSUMER_NAME, { blockMs: 2000, count: 10 });

    for (const { id, fields } of events) {
      const orderId = fields.orderId;
      const items = JSON.parse(fields.items);

      try {
        if (fields.type === 'INVENTORY_RESERVED') {
          const paid = await attemptPayment();

          if (paid) {
            await orders.updateStatus(orderId, 'CONFIRMED');
            console.log(`[${CONSUMER_NAME}] CONFIRMED order ${orderId.slice(0, 8)}`);
          } else {
            // Saga compensation: payment failed downstream, so release the
            // stock we reserved earlier -- this is what stops confirmed
            // reservations from silently locking up inventory forever.
            await inventory.release(items);
            await orders.updateStatus(orderId, 'CANCELLED', 'payment failed, stock released');
            console.log(`[${CONSUMER_NAME}] CANCELLED order ${orderId.slice(0, 8)} (payment failed, stock released back)`);
          }
        }
        // INVENTORY_REJECTED needs no further action here -- the inventory
        // worker already marked the order REJECTED and never touched stock.
      } catch (err) {
        console.error(`[${CONSUMER_NAME}] error processing order ${orderId}:`, err.message);
        continue;
      }

      await bus.ack(INVENTORY_STREAM, GROUP, id);
    }
  }
}

main().catch((err) => {
  console.error(`[${CONSUMER_NAME}] fatal error:`, err);
  process.exit(1);
});
