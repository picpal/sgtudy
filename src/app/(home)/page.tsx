import { MainScreen } from "@/components/main/MainScreen";
import { parseHomeFilters } from "@/components/main/homeUrl";
import { toApiError } from "@/lib/api/errors";
import { DEFAULT_PARAMS, fetchRooms } from "@/lib/api/rooms";
import { getServerClient } from "@/lib/api/me.server";

type SP = Promise<Record<string, string | string[] | undefined>>;

/** 필터는 주소(?tab·status·q·tag)에서 읽어 첫 화면을 그 조건으로 그린다 — 새로고침·공유한 링크가 같은 목록 */
export default async function Home({ searchParams }: { searchParams: SP }) {
  const [sp, client] = await Promise.all([searchParams, getServerClient()]);
  let filters = parseHomeFilters(sp);
  let initial;
  try {
    initial = await fetchRooms({ ...DEFAULT_PARAMS, ...filters }, client);
  } catch (e) {
    // 비로그인으로 ?tab=mine|created 를 열면 공개 방으로 (rooms_list 가 AUTH_REQUIRED)
    if (filters.scope === "public" || toApiError(e).code !== "AUTH_REQUIRED") throw e;
    filters = { ...filters, scope: "public" };
    initial = await fetchRooms({ ...DEFAULT_PARAMS, ...filters }, client);
  }
  return <MainScreen initial={initial} filters={filters} />;
}
