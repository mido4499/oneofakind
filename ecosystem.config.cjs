// pm2 process file: `pm2 start ecosystem.config.cjs`. Settings come from .env (see .env.example).
module.exports = {
  apps: [
    {
      name: 'oneofakind',
      script: 'dist/server.js',
      cwd: __dirname,
      node_args: '--env-file-if-exists=.env',
      max_memory_restart: '300M',
    },
  ],
};
