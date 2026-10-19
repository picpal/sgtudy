import { assertEquals } from "@std/assert";
import { dbTest, RUN, service, userClient } from "./_testenv.ts";

dbTest("node docs storage: editor uploads n/ key, cannot sign until attached; outsider never signs", async () => {
  const { u, c } = await userClient(1);
  const { c: outsider } = await userClient(2);
  const admin = service();
  const ec2 = (await admin.from("goal_nodes").select("id, room_id").eq("title", "EC2 인스턴스 유형 정리").single()).data!;
  const fid = crypto.randomUUID();
  const path = `n/${ec2.room_id}/${ec2.id}/${fid}.png`;
  const blob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
  assertEquals(Boolean((await c.storage.from("attachments").upload(path, blob, { contentType: "image/png" })).error), true);  // 편집자 아님
  await admin.from("room_members").upsert({ room_id: ec2.room_id, user_id: u.id, role: "MEMBER", status: "ACTIVE", joined_at: new Date().toISOString(), can_edit_curriculum: true });
  try {
    assertEquals((await c.rpc("me_update", { p_nickname: "nf" + RUN })).error, null);  // 온보딩
    assertEquals((await c.storage.from("attachments").upload(path, blob, { contentType: "image/png" })).error, null);
    assertEquals((await c.rpc("node_file_register", { p_node: ec2.id, p_path: path, p_name: "x.png", p_mime: "image/png", p_size: 4 })).error, null);
    assertEquals(Boolean((await c.storage.from("attachments").createSignedUrl(path, 60)).error), true);     // 미저장
    assertEquals((await c.rpc("node_files_set", { p_node: ec2.id, p_file_ids: [fid] })).error, null);
    assertEquals((await c.storage.from("attachments").createSignedUrl(path, 60)).error, null);
    assertEquals(Boolean((await outsider.storage.from("attachments").createSignedUrl(path, 60)).error), true);
  } finally {
    await admin.storage.from("attachments").remove([path]);
    await admin.from("files").delete().eq("id", fid);
    await admin.from("room_members").delete().eq("room_id", ec2.room_id).eq("user_id", u.id);
  }
});
