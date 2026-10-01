
import cluster from 'node:cluster';
import os from 'node:os';
import process from 'node:process';
import chalk from 'chalk';

const totalCpus = os.cpus().length;
// Allow environment override via WORKERS or WEB_CONCURRENCY, default to CPU count (min 2, max totalCpus)
const numWorkers = parseInt(process.env.WORKERS || process.env.WEB_CONCURRENCY || '', 10) 
    || Math.max(2, Math.min(totalCpus, 8));

if (cluster.isPrimary || cluster.isMaster) {
    console.log(chalk.bold.cyan('\n============================================================'));
    console.log(chalk.bold.cyan('  🌐 SMART BARANGAY // NATIVE CLUSTER LOAD BALANCER'));
    console.log(chalk.bold.cyan('============================================================'));
    console.log(chalk.gray(`  • Host CPU Cores Detected : `) + chalk.bold.white(totalCpus));
    console.log(chalk.gray(`  • Active Worker Instances : `) + chalk.bold.green(numWorkers));
    console.log(chalk.gray(`  • Balancing Algorithm     : `) + chalk.bold.yellow('OS Round-Robin Kernel Dispatch'));
    console.log(chalk.gray(`  • Shared Target Port      : `) + chalk.bold.white(process.env.PORT || 8000));
    console.log(chalk.bold.cyan('============================================================\n'));

    // Track worker restart counts to prevent rapid crash loops
    const restartHistory = new Map();
    let isShuttingDown = false;

    // Fork initial worker pool
    for (let i = 0; i < numWorkers; i++) {
        const worker = cluster.fork({ WORKER_INDEX: i + 1 });
        restartHistory.set(worker.id, Date.now());
    }

    // Monitor worker online status
    cluster.on('online', (worker) => {
        console.log(chalk.green(`[CLUSTER MASTER] Worker #${worker.id} (PID: ${worker.process.pid}) is ONLINE and accepting traffic.`));
    });

    // Handle unexpected worker exits (Crash Recovery / Auto-Healing)
    cluster.on('exit', (worker, code, signal) => {
        if (isShuttingDown) {
            console.log(chalk.gray(`[CLUSTER MASTER] Worker #${worker.id} (PID: ${worker.process.pid}) terminated cleanly.`));
            return;
        }

        console.error(chalk.bgRed.white.bold(` [ALERT] `) + chalk.red(` Worker #${worker.id} (PID: ${worker.process.pid}) DIED (Code: ${code}, Signal: ${signal}).`));
        console.log(chalk.yellow(`[AUTO-HEAL] Instantiating replacement worker...`));

        // Throttle rapid crash loops (max 1 restart per 1.5 seconds per slot)
        setTimeout(() => {
            if (!isShuttingDown) {
                const newWorker = cluster.fork();
                restartHistory.set(newWorker.id, Date.now());
                console.log(chalk.cyan(`[AUTO-HEAL] Replacement Worker #${newWorker.id} successfully spawned.`));
            }
        }, 1500);
    });

    // Graceful Cluster Shutdown
    const handleClusterShutdown = (signal) => {
        if (isShuttingDown) return;
        isShuttingDown = true;
        console.log(chalk.bold.yellow(`\n[CLUSTER MASTER] Received ${signal}. Initiating graceful cluster termination...`));

        for (const id in cluster.workers) {
            const worker = cluster.workers[id];
            if (worker) {
                console.log(chalk.gray(`[CLUSTER MASTER] Disconnecting Worker #${id}...`));
                worker.disconnect();
            }
        }

        // Force exit if workers don't close within 5 seconds
        setTimeout(() => {
            console.log(chalk.red('[CLUSTER MASTER] Forcing shutdown.'));
            process.exit(0);
        }, 5000);
    };

    process.on('SIGINT', () => handleClusterShutdown('SIGINT'));
    process.on('SIGTERM', () => handleClusterShutdown('SIGTERM'));

} else {
    // WORKER PROCESS
    // Dynamically import and run the main Express application
    import('./index.js').catch((err) => {
        console.error(chalk.red(`[WORKER #${cluster.worker?.id}] Startup Error:`, err));
        process.exit(1);
    });
}
