// PM2 process manifest.
//
//   pm2 start ecosystem.config.js
//   pm2 restart ileads-web
//   pm2 restart ileads-queue-worker
//   pm2 logs ileads-queue-worker
module.exports = {
  apps: [
    {
      name: "ileads-web",
      script: "node_modules/next/dist/bin/next",
      args: "start -H " + (process.env.HOST || "127.0.0.1") + " -p " + (process.env.PORT || "3010"),
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "ileads-queue-worker",
      script: "node_modules/tsx/dist/cli.mjs",
      args: "--require ./scripts/_stt-preload.cjs scripts/queue-worker.ts",
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_memory_restart: "1G",
      kill_timeout: 60_000,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
