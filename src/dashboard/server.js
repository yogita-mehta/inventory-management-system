require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const { createClient } = require('../config/redis');
const { InventoryStore } = require('../inventory/InventoryStore');
const { OrderStore } = require('../orders/OrderStore');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const redis = createClient('dashboard');
const inventory = new InventoryStore(redis);
const orders = new OrderStore(redis);

app.get('/api/stats', async (req, res) => {
  try {
    const [products, orderStats] = await Promise.all([
      inventory.listProducts(),
      orders.getStats(),
    ]);
    res.json({ products, orders: orderStats, timestamp: Date.now() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.DASHBOARD_PORT || 5100;
app.listen(PORT, () => {
  console.log(`Dashboard running at http://localhost:${PORT}`);
});
