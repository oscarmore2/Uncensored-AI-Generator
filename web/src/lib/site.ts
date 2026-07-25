import "server-only";
import { env } from "./env";

export const SITE_NAME = "玩玩可物";
export const SITE_URL = env.APP_URL.replace(/\/+$/, "");

export function absoluteUrl(path = "/"): string {
  return new URL(path, `${SITE_URL}/`).toString();
}
