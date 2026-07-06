const { v4: uuidv4 } = require('uuid');

/**
 * Order lifecycle: PLACED -> RESERVED -> CONFIRMED
 *                          \-> REJECTED (insufficient stock, no reservation made)
 *                RESERVED -> CANCELLED (downstream step failed; stock released via saga compensation)
 */
class OrderStore {
  constructor(redis) {
    this.redis = redis;
  }

  async create(items) {
    const id = uuidv4();
    const now = Date.now();
    await this.redis.hset(`order:${id}`, {
      id,
      items: JSON.stringify(items),
      status: 'PLACED',
      createdAt: String(now),
      updatedAt: String(now),
      reason: '',
    });
    await this.redis.incr('metrics:orders_placed');
    return id;
  }

  async updateStatus(id, status, reason = '') {
    await this.redis.hset(`order:${id}`, {
      status,
      reason,
      updatedAt: String(Date.now()),
    });
    await this.redis.incr(`metrics:orders_${status.toLowerCase()}`);
  }

  async get(id) {
    const order = await this.redis.hgetall(`order:${id}`);
    if (!order || Object.keys(order).length === 0) return null;
    order.items = JSON.parse(order.items || '[]');
    return order;
  }

  async getStats() {
    const keys = [
      'metrics:orders_placed',
      'metrics:orders_reserved',
      'metrics:orders_confirmed',
      'metrics:orders_rejected',
      'metrics:orders_cancelled',
    ];
    const values = await Promise.all(keys.map((k) => this.redis.get(k)));
    const [placed, reserved, confirmed, rejected, cancelled] = values.map((v) => Number(v || 0));
    return { placed, reserved, confirmed, rejected, cancelled };
  }
}

module.exports = { OrderStore };
