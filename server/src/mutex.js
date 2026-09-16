// 极简的按键互斥队列：同一项目的帧写入 / 重排串行执行，
// 避免“连拍两帧”并发请求把文件与索引写乱。
const chains = new Map();

export function withLock(key, task) {
  const previous = chains.get(key) || Promise.resolve();
  const next = previous.then(task, task);
  chains.set(key, next.then(() => {}, () => {}));
  return next;
}
