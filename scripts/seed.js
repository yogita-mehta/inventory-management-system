require('dotenv').config();
const { createClient } = require('../src/config/redis');
const { InventoryStore } = require('../src/inventory/InventoryStore');

const PRODUCTS = [
  { sku: 'SKU-LAPTOP-01', name: 'ThinkPad X1 Carbon', quantity: 200, price: 1299 },
  { sku: 'SKU-PHONE-01', name: 'Pixel 9 Pro', quantity: 300, price: 899 },
  { sku: 'SKU-HEADPHONE-01', name: 'Sony WH-1000XM6', quantity: 500, price: 349 },
  { sku: 'SKU-WATCH-01', name: 'Galaxy Watch 7', quantity: 400, price: 279 },
  { sku: 'SKU-FLASHSALE-01', name: 'Limited Edition Console (Flash Sale)', quantity: 50, price: 499 },
];

async function main() {
  const redis = createClient('seed');
  const inventory = new InventoryStore(redis);

  for (const p of PRODUCTS) {
    await inventory.seedProduct(p.sku, p.name, p.quantity, p.price);
    console.log(`Seeded ${p.sku} — ${p.name} (stock: ${p.quantity})`);
  }

  console.log('\nSeeding complete.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
