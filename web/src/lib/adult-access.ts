import type { User } from "@prisma/client";
import { isVipActive } from "./pricing";

type AdultAccessUser = Pick<
  User,
  "isVip" | "vipExpiresAt" | "adultModeEnabled" | "ageVerifiedAt" | "birthDate"
>;

export function isAtLeast18(birthDate: Date, now = new Date()): boolean {
  const cutoff = new Date(Date.UTC(
    now.getUTCFullYear() - 18,
    now.getUTCMonth(),
    now.getUTCDate()
  ));
  return birthDate.getTime() <= cutoff.getTime();
}

export function hasAdultAccess(user: AdultAccessUser | null | undefined): boolean {
  return Boolean(
    user &&
      isVipActive(user) &&
      user.adultModeEnabled &&
      user.ageVerifiedAt &&
      user.birthDate &&
      isAtLeast18(user.birthDate)
  );
}
