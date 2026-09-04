module.exports = {
  apps: [
    {
      name: "khmer-ocr-backend",
      cwd: "./backend",
      script: "../.venv/bin/uvicorn",
      args: "main:app --host 127.0.0.1 --port 8000 --workers 2",
      interpreter: "none",
      autorestart: true,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        PORT: 8000
      }
    },
    {
      name: "khmer-ocr-frontend",
      cwd: "./frontend",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000 -H 127.0.0.1",
      autorestart: true,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        PORT: 3000
      }
    }
  ]
};
