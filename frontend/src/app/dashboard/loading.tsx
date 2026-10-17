import { cookies } from "next/headers";

import { DashboardSkeleton } from "./skeletons";
import { TAB_COOKIE } from "./tab-cookie";

export default async function Loading() {
  const lastTab = (await cookies()).get(TAB_COOKIE)?.value;
  return <DashboardSkeleton defaultTab={lastTab} />;
}
