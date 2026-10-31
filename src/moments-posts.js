// 只取「有人发的」动态（kind='post'），不含动作卡。
//
// 为什么单独一个文件：state.js 和 moments-store.js 都已经很长，为一条 SQL
// 重写整份不值（和 my-moments.js、my-comments.js 一个做法）。
//
// 为什么要在 SQL 里滤、不在应用层滤：动作卡比动态多得多（每次醒来都有几张）。
// 先 listMoments(20) 再挑出 post，那 20 条配额全花在动作卡上了，
// 页面上只剩两三条动态。所以 WHERE 必须进查询。

import db from './state.js';

// 预编译语句缓存，和 state.js / moments-store.js 一个做法
const cache = new Map();
function stmt(sql) {
  let s = cache.get(sql);
  if (!s) {
    s = db.prepare(sql);
    cache.set(sql, s);
  }
  return s;
}

// 最近 limit 条有人发的动态，新的在前。两个人的都算（author 不限）。
// kind 这列是后加的，老数据默认 'post'（见 moments-store.js 的 ALTER），
// 所以旧日记搬过来的那些也在里面。
export function listPosts(limit = 20) {
  return stmt("SELECT * FROM moments WHERE kind = 'post' ORDER BY ts DESC, id DESC LIMIT ?").all(limit);
}
