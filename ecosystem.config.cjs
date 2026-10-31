// pm2 process file: `pm2 start ecosystem.config.cjs`. Settings come from .env (see .env.example).
module.exports = {
  apps: [
    {
      name: 'oneofakind',
      script: 'dist/server.js',
      cwd: __dirname,
      // Node 22.9+ is required. If the server's default node is older, start pm2 with
      // ONEOFAKIND_NODE=/path/to/node-22/bin/node so only this app uses the newer version.
      interpreter: process.env.ONEOFAKIND_NODE || 'node',
      node_args: '--env-file-if-exists=.env',
      max_memory_restart: '300M',
    },
  ],
};
