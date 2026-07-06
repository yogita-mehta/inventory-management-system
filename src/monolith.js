require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { createClient } = require('./config/redis');
const { InventoryStore } = require('./inventory/InventoryStore');
const { OrderStore } = require('./orders/OrderStore');
const { EventBus } = require('./events/EventBus');

/**
 * 🚀 MONOLITHIC SERVER
 * This combines API, Dashboard, and Workers into ONE process for FREE-TIER cloud hosting.
 */

const app = express();
app.use(express.json());
app.use(cors());

const redis = createClient('monolith');
const inventory = new InventoryStore(redis);
const orders = new OrderStore(redis);
const bus = new EventBus(redis);

// --- 📡 API ROUTES ---
app.get('/api/products', async (req, res) => res.json(await inventory.listProducts()));
app.get('/api/products/:sku', async (req, res) => {
  const p = await inventory.getProduct(req.params.sku);
  p ? res.json(p) : res.status(404).json({ error: 'not found' });
});

app.post('/api/orders', async (req, res) => {
  try {
    const { items } = req.body;
    const orderId = await orders.create(items);
    await bus.publish('events:orders', { orderId, items, type: 'ORDER_PLACED' });
    res.status(202).json({ id: orderId, status: 'PLACED' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/orders/:id', async (req, res) => {
  const o = await orders.get(req.params.id);
  o ? res.json(o) : res.status(404).json({ error: 'not found' });
});

app.get('/api/stats', async (req, res) => {
  const [products, orderStats] = await Promise.all([
    inventory.listProducts(),
    orders.getStats(),
  ]);
  res.json({ products, orders: orderStats, timestamp: Date.now() });
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// --- 📊 DASHBOARD STATIC FILES ---
// Serves the frontend dashboard
app.use(express.static(path.join(__dirname, 'dashboard', 'public')));

// --- ⚙️ START WORKERS ---
console.log('📦 Initializing Background Workers...');
// We require them; they start their event loops on import
require('./workers/inventoryWorker.js');
require('./workers/orderWorker.js');

// --- 🚀 START SERVER ---
const PORT = process.env.PORT || 4100;
app.listen(PORT, () => {
  console.log(`✅ Monolith System running on port ${PORT}`);
  console.log(`📡 API: http://localhost:${PORT}/api`);
  console.log(`📊 Dashboard: http://localhost:${PORT}/`);

  // --- 🪄 LIVE TRAFFIC SIMULATOR ---
  if (process.env.SIMULATION_ENABLED === 'true') {
    const SKUS = ['SKU-LAPTOP-01', 'SKU-PHONE-01', 'SKU-HEADPHONE-01', 'SKU-WATCH-01', 'SKU-FLASHSALE-01'];
    console.log('🪄 Traffic Simulator: ACTIVE');
    
    setInterval(async () => {
      try {
        const randomSku = SKUS[Math.floor(Math.random() * SKUS.length)];
        const qty = Math.floor(Math.random() * 3) + 1;
        const items = [{ sku: randomSku, quantity: qty }];
        
        const orderId = await orders.create(items);
        await bus.publish('events:orders', { orderId, items, type: 'ORDER_PLACED' });
        
        console.log(`[Simulator] Generated order ${orderId.slice(0, 8)} for ${qty}x ${randomSku}`);
      } catch (err) {
        console.error('[Simulator] Error:', err.message);
      }
    }, 5000); // Generate an order every 5 seconds
  }
});
