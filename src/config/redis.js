require('dotenv').config();
const Redis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

function createClient(label = 'client') {
  // Log connection attempt (masked password)
  const maskedUrl = REDIS_URL.replace(/:\/\/.*:.*@/, '://***:***@');
  console.log(`[redis:${label}] attempting to connect to: ${maskedUrl}`);

  const client = new Redis(REDIS_URL, {
    retryStrategy(times) {
      // Exponential backoff with a cap of 5 seconds
      return Math.min(times * 500, 5000);
    },
    // We remove the hard retry limit to prevent crashing during transient network issues
    maxRetriesPerRequest: null,
  });

  client.on('error', (err) => {
    console.error(`[redis:${label}] connection error:`, err.message);
  });

  return client;
}

module.exports = { createClient, REDIS_URL };
