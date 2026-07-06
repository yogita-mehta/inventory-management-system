/**
 * Monolithic Entry Point for Deployment
 * This script starts the API server, the Dashboard, and both Workers in a single process.
 * Ideal for free-tier deployments (Render, Railway, etc.) where running multiple services 
 * is restricted or expensive.
 */

// Import the modules
// Note: We modify the original files slightly if needed to export the start functions
// or we can just require them if they run on import.
// Currently they run on import, so we can just require them.

console.log('🚀 Starting All-in-One Inventory Management System...');

// Increase max listeners for multiple redis connections in one process
process.setMaxListeners(20);

// 1. Start the API
console.log('📡 Starting API Server...');
require('./api/server.js');

// 2. Start the Dashboard
console.log('📊 Starting Dashboard Server...');
require('./dashboard/server.js');

// 3. Start the Inventory Worker
console.log('⚙️ Starting Inventory Worker...');
require('./workers/inventoryWorker.js');

// 4. Start the Order Worker
console.log('📦 Starting Order Worker...');
require('./workers/orderWorker.js');

console.log('✅ All services are running and connected to Redis.');
