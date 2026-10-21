"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { DATE_FIELD_CLASS, FIELD_CLASS } from "@/components/room-new/fields";
import type { NewRoomValues } from "@/components/room-new/validate";
import { ChoiceList } from "@/components/ui/ChoiceList";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Switch } from "@/components/ui/Switch";
import type { ToastMsg } from "@/components/ui/Toast";
import { toApiError } from "@/lib/api/errors";
import { mmdd } from "@/lib/api/format";
import { absoluteUrl, fetchInvite, leaderErrorText, rotateInvite } from "@/lib/api/leader";
import { closeExtraRecruit, extraRecruitDefaults, extraRecruitNote, formatCode, openExtraRecruit, recruitErrorText, recruitMaxDate, setInviteBypass } from "@/lib/api/recruit";
import type { InviteInfo, JoinMode, RoomDetail } from "@/lib/api/types";
import { addDays, weekdayKo } from "@/lib/date";
import { RECRUIT_CHANGED } from "./settings";

type Changed = readonly (keyof NewRoomValues)[];
type Props = { detail: RoomDetail; toast: (m: ToastMsg) => void; onDetail: (next: RoomDetail, changed: Changed) => void };

const BTN = "h-11 w-full rounded-[22px] px-5 text-[14px] font-semibold disabled:opacity-60 md:w-auto";
const BTN_MAIN = `${BTN} bg-navy text-white`;
const BTN_SUB = `${BTN} border border-line-3 bg-surface font-medium text-ink`;
const ROW = "grid grid-cols-[72px_minmax(0,1fr)] items-start gap-x-3";
const CARD = "flex min-w-0 flex-col gap-3 rounded-[16px] border border-line p-4";

const JOIN_CHOICES: { key: JoinMode; label: string }[] = [
  { key: "approval", label: "승인 후 참가" },
  { key: "direct", label: "바로 참가" },
];

/** 라벨-값 한 줄 (390 에서도 한 줄에 칸 하나) */
function Row({ id, label, error, hint, children }: { id?: string; label: string; error?: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className={ROW}>
      <label htmlFor={id} className="pt-[14px] text-[13px] font-semibold text-ink-3">
        {label}
      </label>
      <div className="flex min-w-0 flex-col gap-1">
        {children}
        {hint && !error && <span className="text-[12px] text-muted">{hint}</span>}
        {error && (
          <span role="alert" className="text-[12px] font-medium text-warn">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}

const isInt = (s: string) => /^\d+$/.test(s.trim());

/**
 * 방 설정 「추가 모집 · 초대」(스펙 §4.1) — 바뀌면 바로 저장(방 정보 폼 저장 막대와 따로).
 * 진행중: 추가 모집 카드 + 초대 카드, 모집중: 초대 카드만, 종료·보관: 없음. 서버 응답(RoomDetail·InviteLink)이 진실이고 상태는 입력값만 든다
 */
export function RecruitInviteSection({ detail: d, toast, onDetail }: Props) {
  const shown = !d.archived && (d.status === "active" || d.status === "recruit");
  return shown ? (
    <section aria-labelledby="recruit-invite-title" className="mt-8 flex flex-col gap-3 border-t border-line-2 pt-6">
      <div>
        <h2 id="recruit-invite-title" className="m-0 text-[17px] font-bold">
          추가 모집 · 초대
        </h2>
        <p className="m-0 mt-1 text-[13px] text-muted">
          {d.status === "active" ? "진행중에도 새 참가자를 받을 수 있어요" : "초대 링크·코드를 받은 사람이 이 방으로 들어와요"} · 바꾸면 바로 저장돼요
        </p>
      </div>
      {d.status === "active" && <ExtraRecruitCard d={d} toast={toast} onDetail={onDetail} />}
      <InviteCard d={d} toast={toast} />
    </section>
  ) : null;
}

/* ── 추가 모집 ── */
function ExtraRecruitCard({ d, toast, onDetail }: { d: RoomDetail; toast: Props["toast"]; onDetail: Props["onDetail"] }) {
  const ids = { until: useId(), max: useId() };
  const until0 = d.recruit?.extraUntil ?? null;
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(() => {
    const x = extraRecruitDefaults(d);
    return { until: x.until, max: String(x.maxMembers), mode: x.joinMode };
  });
  // 정원 칸 = 방 정보 폼의 "최대 인원"(스펙 §4.1). 서버 값(정원·방식·인원)이 바뀌면 정원·방식 칸만 다시 채운다 — 렌더 중 조정(React "props 변화에 state 맞추기").
  // 키를 바꿔 다시 마운트하면 고른 마감일·줄 오류까지 날아가고, 효과로 맞추면 한 프레임 옛 값이 보인다. 같은 props 의 재렌더에선 카드 입력을 건드리지 않는다
  const srcKey = `${d.maxMembers}|${d.joinMode}|${d.memberCount}`;
  const [seenKey, setSeenKey] = useState(srcKey);
  if (seenKey !== srcKey) {
    setSeenKey(srcKey);
    const x = extraRecruitDefaults(d);
    setForm((f) => ({ ...f, max: String(until0 ? d.maxMembers : x.maxMembers), mode: until0 ? d.joinMode : x.joinMode }));
  }
  const [errs, setErrs] = useState<{ until?: string; max?: string }>({});
  const [busy, setBusy] = useState(false);
  const [askClose, setAskClose] = useState(false);
  const maxDate = recruitMaxDate(d);
  const showForm = !until0 || editing;

  const check = () => {
    const e: { until?: string; max?: string } = {};
    if (!form.until || form.until < d.today || form.until > maxDate) e.until = `오늘부터 ${mmdd(maxDate)}까지 고를 수 있어요`;
    const n = Number(form.max);
    if (!isInt(form.max) || n < 2 || n > 100) e.max = "정원은 2~100명이에요";
    else if (n <= d.memberCount) e.max = recruitErrorText("CAPACITY_NO_SEAT", "");
    return e;
  };

  const open = async () => {
    if (busy) return;
    const e = check();
    setErrs(e);
    if (e.until || e.max) return;
    setBusy(true);
    try {
      const next = await openExtraRecruit(d.slug, { until: form.until, maxMembers: Number(form.max), joinMode: form.mode });
      onDetail(next, RECRUIT_CHANGED.open);
      const day = mmdd(next.recruit?.extraUntil ?? form.until);
      toast({ text: until0 ? `추가 모집을 바꿨어요 · ${day}까지` : `추가 모집을 시작했어요 · ${day}까지`, tone: "ok" });
      setEditing(false);
    } catch (err) {
      const a = toApiError(err);
      const text = recruitErrorText(a.code, a.message);
      const field = a.details?.field;
      if (field === "recruitUntil") setErrs({ until: text });
      else if (field === "maxMembers") setErrs({ max: text });
      else toast({ text: leaderErrorText(a.code, a.message), tone: "bad" });
    } finally {
      setBusy(false);
    }
  };

  const close = async () => {
    setBusy(true);
    try {
      const next = await closeExtraRecruit(d.slug);
      onDetail(next, RECRUIT_CHANGED.close);
      const x = extraRecruitDefaults(next);
      setForm({ until: x.until, max: String(x.maxMembers), mode: x.joinMode });
      setErrs({});
      setEditing(false);
      toast({ text: "추가 모집을 마감했어요", tone: "ok" });
    } catch (err) {
      const a = toApiError(err);
      toast({ text: leaderErrorText(a.code, a.message), tone: "bad" });
    } finally {
      setBusy(false);
      setAskClose(false);
    }
  };

  const startEdit = () => {
    setForm({ until: until0 ?? extraRecruitDefaults(d).until, max: String(d.maxMembers), mode: d.joinMode });
    setErrs({});
    setEditing(true);
  };

  return (
    <div className={CARD}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3 className="m-0 text-[15px] font-bold">추가 모집</h3>
        {until0 ? (
          <span className="text-[13px] font-semibold text-mint">
            ● {mmdd(until0)}({weekdayKo(until0)})까지 · {d.joinMode === "approval" ? "승인제" : "바로 참가"}
          </span>
        ) : (
          <span className="text-[13px] text-muted">꺼짐</span>
        )}
      </div>
      {until0 && (
        <p className="m-0 text-[13px] text-ink-2">
          {d.memberCount}/{d.maxMembers}명 · 승인 대기 {d.pendingCount}명
        </p>
      )}

      {showForm && (
        <div className="flex flex-col gap-3">
          <Row id={ids.until} label="마감일" error={errs.until} hint={`오늘~${mmdd(maxDate)} 중 (최대 30일)`}>
            <input id={ids.until} name="recruitUntil" type="date" className={DATE_FIELD_CLASS} min={d.today} max={maxDate} value={form.until} disabled={busy} onChange={(e) => setForm((f) => ({ ...f, until: e.target.value }))} aria-invalid={!!errs.until} />
          </Row>
          <Row id={ids.max} label="정원" error={errs.max} hint={`지금 ${d.memberCount}명 · 최대 100명`}>
            <input id={ids.max} name="recruitMax" type="number" inputMode="numeric" className={FIELD_CLASS} min={d.memberCount + 1} max={100} value={form.max} disabled={busy} onChange={(e) => setForm((f) => ({ ...f, max: e.target.value }))} aria-invalid={!!errs.max} />
          </Row>
          <div className={ROW}>
            <span className="pt-[12px] text-[13px] font-semibold text-ink-3">참가 방식</span>
            <div className="min-w-0">
              <ChoiceList legend="추가 모집 참가 방식" value={form.mode} onChange={(k) => !busy && setForm((f) => ({ ...f, mode: k }))} choices={JOIN_CHOICES} />
            </div>
          </div>
          <p className="m-0 text-[12px] leading-[1.6] text-muted">{extraRecruitNote(d)}</p>
        </div>
      )}

      <div className="flex flex-col gap-2 md:flex-row md:justify-end">
        {!until0 && (
          <button type="button" onClick={() => void open()} disabled={busy} aria-label="추가 모집 시작" className={BTN_MAIN}>
            {busy ? "시작하는 중…" : "추가 모집 시작"}
          </button>
        )}
        {until0 && editing && (
          <>
            <button type="button" onClick={() => setEditing(false)} disabled={busy} className={BTN_SUB}>
              취소
            </button>
            <button type="button" onClick={() => void open()} disabled={busy} aria-label="추가 모집 기간·정원 저장" className={BTN_MAIN}>
              {busy ? "저장하는 중…" : "저장"}
            </button>
          </>
        )}
        {until0 && !editing && (
          <>
            <button type="button" onClick={startEdit} disabled={busy} className={BTN_SUB}>
              기간·정원 바꾸기
            </button>
            <button type="button" onClick={() => setAskClose(true)} disabled={busy} className={`${BTN} border border-danger bg-surface text-danger`}>
              지금 마감
            </button>
          </>
        )}
      </div>

      <ConfirmDialog
        open={askClose}
        title="추가 모집을 마감할까요?"
        body={`승인 대기 ${d.pendingCount}명의 신청은 만료돼요`}
        confirmLabel="마감"
        danger
        busy={busy}
        onCancel={() => setAskClose(false)}
        onConfirm={() => void close()}
      />
    </div>
  );
}

/* ── 초대 코드 · 링크 · 바로 참가 ── */
function InviteCard({ d, toast }: { d: RoomDetail; toast: Props["toast"] }) {
  const ids = { until: useId(), max: useId() };
  const [inv, setInv] = useState<InviteInfo | null>(d.invite);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [askRotate, setAskRotate] = useState(false);
  const maxDate = recruitMaxDate(d);
  const bypass = inv?.bypass ?? null;
  const defUntil = () => {
    const week = addDays(d.today, 7);
    return week < maxDate ? week : maxDate;
  };
  // 스위치: 저장된 바로 참가가 있으면 켜짐, 없으면 사용자가 켜서 입력을 펼친 상태
  const [on, setOn] = useState(!!bypass);
  const [bf, setBf] = useState(() => ({ until: bypass?.until ?? defUntil(), max: bypass?.max == null ? "" : String(bypass.max) }));
  const [errs, setErrs] = useState<{ until?: string; max?: string }>({});

  const needFetch = !inv?.code;
  useEffect(() => {
    if (!needFetch) return;
    let live = true;
    fetchInvite(d.slug)
      .then((r) => live && setInv(r))
      .catch((e) => live && setLoadError(toApiError(e).message || "초대 코드를 불러오지 못했어요"));
    return () => {
      live = false;
    };
  }, [d.slug, needFetch]);

  const copy = async (text: string, ok: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ text: ok, tone: "ok" });
    } catch {
      toast({ text: "복사하지 못했어요 · 직접 선택해 복사해 주세요", tone: "bad" });
    }
  };

  const rotate = async () => {
    setBusy(true);
    try {
      const r = await rotateInvite(d.slug);
      setInv(r);
      setOn(false);
      setBf({ until: defUntil(), max: "" });
      setErrs({});
      toast({ text: "새 초대 코드를 만들었어요 · 이전 링크·코드는 더 이상 열리지 않아요", tone: "ok" });
    } catch (e) {
      const a = toApiError(e);
      toast({ text: leaderErrorText(a.code, a.message), tone: "bad" });
    } finally {
      setBusy(false);
      setAskRotate(false);
    }
  };

  const saveBypass = async () => {
    if (busy) return;
    const e: { until?: string; max?: string } = {};
    if (!bf.until || bf.until < d.today || bf.until > maxDate) e.until = `오늘부터 ${mmdd(maxDate)}까지 고를 수 있어요`;
    const n = Number(bf.max);
    if (bf.max.trim() && (!isInt(bf.max) || n < 1 || n > 100)) e.max = "인원 한도는 1~100명이에요";
    setErrs(e);
    if (e.until || e.max) return;
    setBusy(true);
    try {
      const r = await setInviteBypass(d.slug, bf.until, bf.max.trim() ? n : null);
      setInv(r);
      toast({ text: `바로 참가를 저장했어요 · ${mmdd(bf.until)}까지`, tone: "ok" });
    } catch (err) {
      const a = toApiError(err);
      const text = recruitErrorText(a.code, a.message);
      if (a.details?.field === "bypassUntil") setErrs({ until: text });
      else if (a.details?.field === "bypassMax") setErrs({ max: text });
      else toast({ text: leaderErrorText(a.code, a.message), tone: "bad" });
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (next: boolean) => {
    if (busy) return;
    setErrs({});
    if (next) {
      setBf({ until: bypass?.until ?? defUntil(), max: bypass?.max == null ? "" : String(bypass.max) });
      setOn(true);
      return;
    }
    setOn(false);
    if (!bypass) return; // 저장 전이면 접기만
    setBusy(true);
    try {
      setInv(await setInviteBypass(d.slug, null, null));
      toast({ text: "바로 참가를 껐어요", tone: "ok" });
    } catch (err) {
      setOn(true);
      const a = toApiError(err);
      toast({ text: leaderErrorText(a.code, a.message) || "바로 참가를 끄지 못했어요", tone: "bad" });
    } finally {
      setBusy(false);
    }
  };

  const code = inv?.code ?? null;
  return (
    <div className={CARD}>
      <h3 className="m-0 text-[15px] font-bold">초대 코드</h3>
      {loadError && (
        <p role="alert" className="m-0 text-[13px] text-warn">
          {loadError}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <span className="font-mono text-[28px] font-bold tracking-[0.08em] whitespace-nowrap text-ink">{code ? formatCode(code) : "····-····"}</span>
        <button type="button" onClick={() => code && void copy(formatCode(code), "초대 코드를 복사했어요")} disabled={!code} aria-label="초대 코드 복사" className={BTN_SUB}>
          코드 복사
        </button>
      </div>
      <div className="flex flex-col gap-2 md:flex-row md:justify-end">
        <button type="button" onClick={() => inv && void copy(absoluteUrl(inv.url, window.location.origin), "초대 링크를 복사했어요")} disabled={!inv} aria-label="초대 링크 복사" className={BTN_SUB}>
          초대 링크 복사
        </button>
        <button type="button" onClick={() => setAskRotate(true)} disabled={busy || !inv} aria-label="새 코드로 바꾸기" className={BTN_SUB}>
          새 코드로 바꾸기
        </button>
      </div>

      <div className="flex flex-col gap-3 border-t border-line pt-3">
        <div className="flex min-h-11 items-center gap-3">
          <span className="min-w-0 flex-1 text-[14px] font-semibold">모집이 끝나도 이 초대로 바로 참가</span>
          <Switch on={on} label="모집이 끝나도 이 초대로 바로 참가" disabled={busy || !inv} onChange={(v) => void toggle(v)} />
        </div>
        {on && (
          <>
            <Row id={ids.until} label="기한" error={errs.until} hint={`오늘~${mmdd(maxDate)} 중`}>
              <input id={ids.until} name="bypassUntil" type="date" className={DATE_FIELD_CLASS} min={d.today} max={maxDate} value={bf.until} disabled={busy} onChange={(e) => setBf((f) => ({ ...f, until: e.target.value }))} aria-invalid={!!errs.until} />
            </Row>
            <Row id={ids.max} label="인원" error={errs.max} hint="명까지 · 비우면 정원까지">
              <input id={ids.max} name="bypassMax" type="number" inputMode="numeric" className={FIELD_CLASS} min={1} max={100} placeholder="정원까지" value={bf.max} disabled={busy} onChange={(e) => setBf((f) => ({ ...f, max: e.target.value }))} aria-invalid={!!errs.max} />
            </Row>
            {bypass && (
              <p className={`m-0 text-[13px] ${bypass.active ? "text-ink-2" : "font-medium text-warn"}`}>
                {bypass.active
                  ? `${bypass.used}명 사용${bypass.max ? ` / ${bypass.max}명` : ""} · 승인 없이 바로 참가해요`
                  : "기한이 지났거나 인원이 찼어요 · 기한·인원을 늘리거나 새 코드로 바꿔 주세요"}
              </p>
            )}
            <div className="flex flex-col md:flex-row md:justify-end">
              <button type="button" onClick={() => void saveBypass()} disabled={busy} aria-label="바로 참가 저장" className={BTN_MAIN}>
                {busy ? "저장하는 중…" : "저장"}
              </button>
            </div>
          </>
        )}
      </div>

      <ConfirmDialog
        open={askRotate}
        title="초대 코드를 새로 만들까요?"
        body="지금 링크는 더 이상 열리지 않아요. 이미 참가한 사람에게는 영향이 없어요. 바로 참가 설정도 꺼져요"
        confirmLabel="새 코드 만들기"
        busy={busy}
        onCancel={() => setAskRotate(false)}
        onConfirm={() => void rotate()}
      />
    </div>
  );
}
