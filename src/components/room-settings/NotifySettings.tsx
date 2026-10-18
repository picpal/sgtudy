"use client";

import { useEffect, useRef, useState } from "react";
import { ChoiceList } from "@/components/ui/ChoiceList";
import { Switch } from "@/components/ui/Switch";
import type { ToastMsg } from "@/components/ui/Toast";
import { toApiError } from "@/lib/api/errors";
import { NOTIFY_ROWS, fetchNotifySettings, putNotifySettings, type NotifySettings } from "@/lib/api/leader";

/**
 * 방 알림 설정 (settings_get/put, 그룹장 전용) — 바꾸면 바로 저장한다(방 정보 폼의 저장 막대와 따로).
 * 이 방 참가자 모두에게 적용된다. 0025: 팀원 제출 하루 요약(그룹장에게)을 끌 수 있다.
 */
export function NotifySettingsSection({ slug, toast, disabled = false }: { slug: string; toast: (m: ToastMsg) => void; disabled?: boolean }) {
  const [s, setS] = useState<NotifySettings | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const live = useRef(s);
  useEffect(() => {
    live.current = s;
  });

  useEffect(() => {
    let on = true;
    fetchNotifySettings(slug)
      .then((r) => on && setS(r))
      .catch((e) => on && setError(toApiError(e).message || "알림 설정을 불러오지 못했어요"));
    return () => {
      on = false;
    };
  }, [slug]);

  const put = async (next: NotifySettings, okText: string) => {
    const before = live.current;
    if (!before || busy) return;
    setS(next);
    setBusy(true);
    try {
      setS(await putNotifySettings(slug, next));
      toast({ text: okText, tone: "ok" });
    } catch (e) {
      setS(before);
      toast({ text: toApiError(e).message || "알림 설정을 바꾸지 못했어요 · 잠시 후 다시 시도해 주세요", tone: "bad" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="notify-settings-title" className="mt-8 flex flex-col gap-3 border-t border-line-2 pt-6">
      <div>
        <h2 id="notify-settings-title" className="m-0 text-[17px] font-bold">
          알림 설정
        </h2>
        <p className="m-0 mt-1 text-[13px] text-muted">이 방 참가자 모두에게 적용돼요 · 바꾸면 바로 저장돼요. 참가 승인·회차 시작 같은 기본 알림은 항상 가요</p>
      </div>
      {error && <p role="alert" className="m-0 text-[13px] text-warn">{error}</p>}
      {!s && !error && <p className="m-0 text-[13px] text-muted">불러오는 중…</p>}
      {s && (
        <>
          <ul className="m-0 flex list-none flex-col p-0">
            {NOTIFY_ROWS.map((r) => (
              <li key={r.key} className="flex min-h-11 items-center gap-3 border-t border-line py-[10px] first:border-t-0">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[14px] font-semibold">{r.title}</span>
                  <span className="text-[12px] text-muted">{r.desc}</span>
                </span>
                <Switch on={s[r.key]} label={r.title} disabled={disabled || busy} onChange={(v) => void put({ ...s, [r.key]: v }, `${r.title}을 ${v ? "켰어요" : "껐어요"}`)} />
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-2 border-t border-line pt-3">
            <span className="text-[14px] font-semibold">모두 제출한 과제 알림 (그룹장에게)</span>
            <ChoiceList
              legend="모두 제출한 과제 알림"
              value={s.completionMode}
              onChange={(v) => !disabled && !busy && void put({ ...s, completionMode: v }, v === "daily" ? "모두 제출 알림을 하루에 한 번 모아서 보내요" : "모두 제출 알림을 바로 보내요")}
              choices={[
                { key: "daily", label: "하루에 한 번 모아서", note: "매일 오전 9시에 전날 모두 제출한 과제를 모아 알려요" },
                { key: "immediate", label: "바로", note: "담당자가 모두 제출하면 그때 알려요" },
              ]}
            />
          </div>
        </>
      )}
    </section>
  );
}
