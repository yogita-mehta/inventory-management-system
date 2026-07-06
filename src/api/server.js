require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('../config/redis');
const { InventoryStore } = require('../inventory/InventoryStore');
const { OrderStore } = require('../orders/OrderStore');
const { EventBus } = require('../events/EventBus');

const ORDERS_STREAM = 'events:orders';

const app = express();
app.use(express.json());
app.use(cors());

const redis = createClient('api');
const inventory = new InventoryStore(redis);
const orders = new OrderStore(redis);
const bus = new EventBus(redis);

app.get('/products', async (req, res) => {
  const products = await inventory.listProducts();
  res.json(products);
});

app.get('/products/:sku', async (req, res) => {
  const product = await inventory.getProduct(req.params.sku);
  if (!product) return res.status(404).json({ error: 'product not found' });
  res.json(product);
});

app.post('/orders', async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items must be a non-empty array of {sku, quantity}' });
    }
    for (const item of items) {
      if (!item.sku || !item.quantity || item.quantity <= 0) {
        return res.status(400).json({ error: 'each item needs a valid sku and positive quantity' });
      }
    }

    const orderId = await orders.create(items);

    // Emit the event; the inventory worker will pick this up asynchronously
    // and attempt the atomic reservation.
    await bus.publish(ORDERS_STREAM, { orderId, items, type: 'ORDER_PLACED' });

    res.status(202).json({ id: orderId, status: 'PLACED' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/orders/:id', async (req, res) => {
  const order = await orders.get(req.params.id);
  if (!order) return res.status(404).json({ error: 'order not found' });
  res.json(order);
});

app.get('/stats', async (req, res) => {
  const stats = await orders.getStats();
  res.json(stats);
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.API_PORT || 4100;
app.listen(PORT, () => {
  console.log(`Order/Inventory API listening on port ${PORT}`);
  console.log(`  GET    /products      - list all products with live stock`);
  console.log(`  GET    /products/:sku - get one product`);
  console.log(`  POST   /orders        - place an order { items: [{sku, quantity}] }`);
  console.log(`  GET    /orders/:id    - check order status`);
  console.log(`  GET    /stats         - order funnel stats`);
});
