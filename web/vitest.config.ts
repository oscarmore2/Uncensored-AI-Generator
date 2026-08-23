import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * 只跑纯逻辑单测。
 *
 * 序列化 round-trip 是这个项目里最该有单测的东西：它是纯函数、没有 IO、
 * 出错的方式又全是「肉眼看不出来」那一类（多一个空格、少一个换行、
 * 引用被吃掉），靠手点是发现不了的。
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
