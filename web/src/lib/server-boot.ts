import "server-only";

/**
 * 「这一代服务端」的标识，随响应发给前端，用来让本地草稿在服务端换代后自动失效。
 *
 * 优先用平台给的部署 ID：Railway 多副本时每个容器都是独立进程，
 * 若用进程启动时间，同一次部署的两个副本会给出两个不同的值，
 * 用户请求轮到另一个副本就会把草稿误判成过期。部署 ID 对同次部署的
 * 所有副本一致，重新部署才会变，正是我们想要的粒度。
 * 本地开发没有这些变量，退回进程启动时间——重启即清，符合直觉。
 */
export const SERVER_BOOT_ID =
  process.env.RAILWAY_DEPLOYMENT_ID ||
  process.env.RAILWAY_GIT_COMMIT_SHA ||
  `boot-${Date.now().toString(36)}`;
