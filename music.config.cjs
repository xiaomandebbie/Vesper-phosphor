module.exports = {
  apps: [
    {
      name: 'music-mcp',
      script: 'mcp/music_mcp.py',
      interpreter: 'python3',
      cwd: __dirname,
      time: true,
      env: {
        MUSIC_BASE: 'http://127.0.0.1:9090',
        MCP_HOST: '127.0.0.1',
        MCP_PORT: '18012',
        MCP_SIGN_AS: '允朔',
        MUSIC_TZ_OFFSET: '8',
        MUSIC_PUBLIC_URL: 'https://vesperphosphor.online/music/',
      },
    },
  ],
};
