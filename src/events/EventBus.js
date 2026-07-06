/**
 * Thin wrapper around Redis Streams for durable, at-least-once event delivery
 * between services. Unlike Redis Pub/Sub, Streams persist events and support
 * consumer groups, so a worker that's briefly down doesn't lose events, and
 * multiple worker instances in the same group share the load without
 * double-processing (each event is delivered to exactly one consumer in the group).
 */
class EventBus {
  constructor(redis) {
    this.redis = redis;
  }

  async publish(stream, event) {
    const fields = [];
    for (const [k, v] of Object.entries(event)) {
      fields.push(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    }
    return this.redis.xadd(stream, '*', ...fields);
  }

  async ensureGroup(stream, group) {
    try {
      await this.redis.xgroup('CREATE', stream, group, '0', 'MKSTREAM');
    } catch (err) {
      if (!String(err.message).includes('BUSYGROUP')) throw err;
      // group already exists — fine
    }
  }

  /**
   * Blocking read of new events for a consumer group. Returns a parsed list
   * of { id, fields } or an empty array if nothing arrived within blockMs.
   */
  async consume(stream, group, consumerName, { blockMs = 2000, count = 10 } = {}) {
    const res = await this.redis.xreadgroup(
      'GROUP', group, consumerName,
      'COUNT', count,
      'BLOCK', blockMs,
      'STREAMS', stream, '>'
    );
    if (!res) return [];

    const [[, entries]] = res;
    return entries.map(([id, flat]) => {
      const fields = {};
      for (let i = 0; i < flat.length; i += 2) fields[flat[i]] = flat[i + 1];
      return { id, fields };
    });
  }

  async ack(stream, group, id) {
    await this.redis.xack(stream, group, id);
  }
}

module.exports = { EventBus };
