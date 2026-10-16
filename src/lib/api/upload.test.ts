import { describe, expect, it } from "vitest";
import { uploadObject, uploadErrorText } from "./upload";

class FakeXhr {
  static last: FakeXhr;
  method = ""; url = ""; headers: Record<string, string> = {}; body: unknown; status = 0; aborted = false;
  upload: { onprogress: ((e: { loaded: number; total: number; lengthComputable: boolean }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null; onerror: (() => void) | null = null; onabort: (() => void) | null = null;
  constructor() { FakeXhr.last = this; }
  open(m: string, u: string) { this.method = m; this.url = u; }
  setRequestHeader(k: string, v: string) { this.headers[k.toLowerCase()] = v; }
  send(b: unknown) { this.body = b; }
  abort() { this.aborted = true; this.onabort?.(); }
}
const base = { url: "https://p.supabase.co", anonKey: "anon", token: "tok", key: "7/21/u/x.png", body: new Blob(["x"]), contentType: "image/png", xhr: () => new FakeXhr() as unknown as XMLHttpRequest };

describe("uploadObject", () => {
  it("POSTs to the storage object URL with auth headers and reports progress", async () => {
    const seen: number[] = [];
    const p = uploadObject({ ...base, onProgress: (n) => seen.push(n) });
    const x = FakeXhr.last;
    expect([x.method, x.url]).toEqual(["POST", "https://p.supabase.co/storage/v1/object/attachments/7/21/u/x.png"]);
    expect(x.headers).toMatchObject({ authorization: "Bearer tok", apikey: "anon", "content-type": "image/png", "x-upsert": "false" });
    x.upload.onprogress?.({ loaded: 50, total: 100, lengthComputable: true });
    x.status = 200; x.onload?.();
    await p;
    expect(seen).toEqual([50, 100]);
  });
  it("rejects with a status on HTTP errors", async () => {
    const p = uploadObject(base);
    FakeXhr.last.status = 413; FakeXhr.last.onload?.();
    await expect(p).rejects.toMatchObject({ status: 413 });
  });
  it("aborts via signal", async () => {
    const ac = new AbortController();
    const p = uploadObject({ ...base, signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toMatchObject({ aborted: true });
    expect(FakeXhr.last.aborted).toBe(true);
  });
  it("network error → status 0", async () => {
    const p = uploadObject(base);
    FakeXhr.last.onerror?.();
    await expect(p).rejects.toMatchObject({ status: 0 });
  });
});

describe("uploadErrorText", () => {
  it("maps statuses to spec copy", () => {
    expect(uploadErrorText(413)).toBe("10MB를 넘는 파일이에요");
    expect(uploadErrorText(415)).toBe("올릴 수 없는 형식이에요");
    expect(uploadErrorText(403)).toBe("이 과제에 파일을 올릴 수 없어요");
    expect(uploadErrorText(0)).toBe("올리지 못했어요 · 다시 시도해 주세요");
    expect(uploadErrorText(500)).toBe("올리지 못했어요 · 다시 시도해 주세요");
    expect(uploadErrorText(401)).toBe("로그인이 만료됐어요 · 다시 로그인해 주세요");
  });
});
