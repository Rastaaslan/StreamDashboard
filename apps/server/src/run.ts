import { startDashboardServer } from './index.js';

const dashboard = await startDashboardServer();
const shutdown = async () => { await dashboard.stop(); process.exit(0); };
process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });
