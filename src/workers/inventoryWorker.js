require('dotenv').config();
const { createClient } = require('../config/redis');
const { InventoryStore } = require('../inventory/InventoryStore');
const { OrderStore } = require('../orders/OrderStore');
const { EventBus } = require('../events/EventBus');

const ORDERS_STREAM = 'events:orders';
const INVENTORY_STREAM = 'events:inventory';
const GROUP = 'inventory-service';
const CONSUMER_NAME = `inventory-worker-${process.pid}`;

async function main() {
  const redis = createClient(CONSUMER_NAME);
  const inventory = new InventoryStore(redis);
  const orders = new OrderStore(redis);
  const bus = new EventBus(redis);

  await bus.ensureGroup(ORDERS_STREAM, GROUP);
  console.log(`[${CONSUMER_NAME}] consuming "${ORDERS_STREAM}" as group "${GROUP}"`);

  while (true) {
    const events = await bus.consume(ORDERS_STREAM, GROUP, CONSUMER_NAME, { blockMs: 2000, count: 10 });

    for (const { id, fields } of events) {
      const orderId = fields.orderId;
      const items = JSON.parse(fields.items);

      try {
        const result = await inventory.reserve(items);

        if (result.ok) {
          await orders.updateStatus(orderId, 'RESERVED');
          await bus.publish(INVENTORY_STREAM, { orderId, items, type: 'INVENTORY_RESERVED' });
          console.log(`[${CONSUMER_NAME}] RESERVED  order ${orderId.slice(0, 8)} (${items.length} item(s))`);
        } else {
          await orders.updateStatus(orderId, 'REJECTED', `insufficient stock for ${result.failedSku}`);
          await bus.publish(INVENTORY_STREAM, { orderId, items, type: 'INVENTORY_REJECTED', reason: result.failedSku });
          console.log(`[${CONSUMER_NAME}] REJECTED  order ${orderId.slice(0, 8)} (out of stock: ${result.failedSku})`);
        }
      } catch (err) {
        console.error(`[${CONSUMER_NAME}] error processing order ${orderId}:`, err.message);
        // Deliberately do not ack -- event will be redelivered to this group on restart via XPENDING/XCLAIM in a fuller implementation.
        continue;
      }

      await bus.ack(ORDERS_STREAM, GROUP, id);
    }
  }
}

main().catch((err) => {
  console.error(`[${CONSUMER_NAME}] fatal error:`, err);
  process.exit(1);
});
