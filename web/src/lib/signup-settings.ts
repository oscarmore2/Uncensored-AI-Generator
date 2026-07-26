import "server-only";
import { db } from "./db";

export const SIGNUP_INITIAL_CREDITS_KEY = "signup_initial_credits";
export const DEFAULT_SIGNUP_INITIAL_CREDITS = 200;
export const MAX_SIGNUP_INITIAL_CREDITS = 100_000;

export async function getSignupInitialCredits(): Promise<number> {
  const setting = await db.appSetting.findUnique({
    where: { key: SIGNUP_INITIAL_CREDITS_KEY },
    select: { value: true },
  });
  if (!setting) return DEFAULT_SIGNUP_INITIAL_CREDITS;
  const value = Number(setting.value);
  return Number.isInteger(value) && value >= 0 && value <= MAX_SIGNUP_INITIAL_CREDITS
    ? value
    : DEFAULT_SIGNUP_INITIAL_CREDITS;
}

export async function setSignupInitialCredits(value: number): Promise<void> {
  await db.appSetting.upsert({
    where: { key: SIGNUP_INITIAL_CREDITS_KEY },
    create: { key: SIGNUP_INITIAL_CREDITS_KEY, value: String(value) },
    update: { value: String(value) },
  });
}
