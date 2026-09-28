// pm2 进程配置。用法：
//   pm2 start ecosystem.config.cjs
//   pm2 save
// 用 .cjs 后缀是因为 package.json 里写了 "type": "module"，
// 而 pm2 读配置文件要用 CommonJS 格式。

const common = {
  // .env 是按"启动时所在目录"找的。固定成项目根目录，
  // 不管在哪个目录执行 pm2 start 都读得到。
  cwd: __dirname,
  // 崩溃后不立刻重启：从 1 秒开始逐次拉长间隔（pm2 上限 15 秒）。
  // 启动就崩的情况不会一秒几次地刷重启次数，日志也不会被刷屏。
  // 进程稳定运行一段时间后，间隔会自动恢复。
  exp_backoff_restart_delay: 1000,
  // pm2 stop / restart 时给 5 秒收尾（关数据库），超时才强制杀。
  kill_timeout: 5000,
  // 日志每行前面加时间，排查时知道是什么时候出的错。
  time: true,
};

module.exports = {
  apps: [
    { ...common, name: 'vesper', script: 'src/vesper.js' },
    { ...common, name: 'vesper-gateway', script: 'src/gateway.js' },
    { ...common, name: 'phosphor', script: 'src/phosphor.js' },
  ],
};
