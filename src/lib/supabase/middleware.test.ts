import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { updateSession } from "./middleware";

describe("updateSession without Supabase env (I2)", () => {
  const saved = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY };
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  });
  afterEach(() => {
    if (saved.url !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = saved.url;
    if (saved.key !== undefined) process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = saved.key;
  });

  it("passes the request through as unauthenticated instead of throwing", async () => {
    const res = await updateSession(new NextRequest("http://localhost:3000/my-study"));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });
});
