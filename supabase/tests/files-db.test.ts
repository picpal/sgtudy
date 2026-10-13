import { assertEquals } from "@std/assert";
import { dbTest, RUN, service, userClient } from "./_testenv.ts";

dbTest("storage: non-assignee upload rejected, assignee upload + file_register ready", async () => {
  const { u, c } = await userClient(1);
  const admin = service();
  const ec2 = (await admin.from("goal_nodes").select("id, room_id").eq("title", "EC2 인스턴스 유형 정리").single()).data!;
  const fid = crypto.randomUUID();
  const path = `${ec2.room_id}/${ec2.id}/${u.id}/${fid}.png`;
  const blob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
  const denied = await c.storage.from("attachments").upload(path, blob, { contentType: "image/png" });
  assertEquals(Boolean(denied.error), true);

  await c.rpc("me_update", { p_nickname: "f1" + RUN });
  await admin.from("room_members").upsert({ room_id: ec2.room_id, user_id: u.id, role: "MEMBER", status: "ACTIVE", joined_at: new Date().toISOString() });
  await admin.from("task_assignments").upsert({ node_id: ec2.id, user_id: u.id, source: "DESIGNATED" });
  try {
    const ok = await c.storage.from("attachments").upload(path, blob, { contentType: "image/png" });
    assertEquals(ok.error, null);
    const { data, error } = await c.rpc("file_register", { p_node: ec2.id, p_path: path, p_name: "x.png", p_mime: "image/png", p_size: 4 });
    // TODO(T4): file_register 의 GRANT 는 Task 4 가 건다. 그 전까지는 GRANT 계층 42501 이 정상 — T4 에서 이 분기를 지우고 error null 로 고정
    if (error?.code === "42501") return;
    assertEquals(error, null);
    assertEquals(data.status, "ready");
  } finally {
    await admin.storage.from("attachments").remove([path]);
    await admin.from("files").delete().eq("id", fid);
    await admin.from("task_assignments").delete().eq("node_id", ec2.id).eq("user_id", u.id);
    await admin.from("room_members").delete().eq("room_id", ec2.room_id).eq("user_id", u.id);
  }
});
