// PM2 process definitions for the library.
// Secrets are NOT here: the app reads .env.local itself, and MinIO reads
// deploy/.env inside its wrapper. `pm2 save` therefore persists no secrets.
module.exports = {
  apps: [
    {
      name: 'alveron-library-minio',
      script: './deploy/run-minio.sh',
      cwd: '/var/www/alveron-library',
      interpreter: 'none',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      out_file: '/var/www/alveron-library/logs/minio.out.log',
      error_file: '/var/www/alveron-library/logs/minio.err.log',
      merge_logs: true,
      time: true,
    },
    {
      name: 'alveron-library',
      script: 'npm',
      args: 'run start -- -H 127.0.0.1 -p 3001',
      cwd: '/var/www/alveron-library',
      interpreter: 'none',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      kill_timeout: 10000,
      out_file: '/var/www/alveron-library/logs/app.out.log',
      error_file: '/var/www/alveron-library/logs/app.err.log',
      merge_logs: true,
      time: true,
    },
  ],
};
