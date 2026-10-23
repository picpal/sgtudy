"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchNodeFilesOrEmpty, nodeImageUrls } from "@/lib/api/nodeFiles";
import type { FileMeta } from "@/lib/api/types";
import { isImageMime, isSvgMime } from "@/lib/files/imageMime";
import type { ImageResolver } from "./MarkdownView";

type Listed = { node: string; files: FileMeta[] | null };

/**
 * 보기 상세 한 노드의 첨부 목록 + 설명 속 그림 resolver (md-images 스펙 §4.1).
 * 설명(MarkdownView)과 첨부 목록(NodeAttachments)이 같은 목록·같은 서명 URL 을 쓴다 — fetch 는 마운트 뒤 한 번.
 * 그림 URL 은 이미지 파일만 inline 서명(1시간). 같은 이름이 여럿이면 목록의 마지막(= 가장 늦게 붙은 것, D5).
 * 썸네일·설명 그림·라이트박스가 같은 서명 URL 을 쓰고, 라이트박스는 openId 하나로 연다(B3)
 */
export function useNodeFiles(nodeId: string) {
  const [listed, setListed] = useState<Listed>({ node: nodeId, files: null });
  // 서명 결과 — null 이면 그 파일은 서명을 못 받았다
  const [urls, setUrls] = useState<ReadonlyMap<string, string | null>>(new Map());
  const files = useMemo(() => (listed.node === nodeId ? listed.files : null), [listed, nodeId]);

  useEffect(() => {
    let live = true;
    fetchNodeFilesOrEmpty(nodeId)
      .then((l) => live && setListed({ node: nodeId, files: l }))
      .catch(() => live && setListed({ node: nodeId, files: [] }));
    return () => {
      live = false;
    };
  }, [nodeId]);

  // 서명 요청 중인 id — 목록이 그사이 바뀌어도 같은 파일을 두 번 서명하지 않게
  const signing = useRef(new Set<string>());
  const sign = useCallback(async (targets: FileMeta[]) => {
    targets.forEach((f) => signing.current.add(f.id));
    let got = new Map<string, string>();
    try {
      got = await nodeImageUrls(targets);
    } catch {
      // 서명 실패 — 그 그림들은 「찾을 수 없어요」(아래 resolve)
    }
    targets.forEach((f) => signing.current.delete(f.id));
    setUrls((prev) => {
      const next = new Map(prev);
      for (const f of targets) next.set(f.id, got.get(f.id) ?? null);
      return next;
    });
  }, []);

  // 목록이 바뀌면(빼기·다시 받기) 아직 서명 안 한 그림만 서명
  useEffect(() => {
    const todo = (files ?? []).filter((f) => isImageMime(f.contentType) && !urls.has(f.id) && !signing.current.has(f.id));
    if (todo.length > 0) void sign(todo);
  }, [files, urls, sign]);

  const setFiles = useCallback((l: FileMeta[]) => setListed({ node: nodeId, files: l }), [nodeId]);
  // 라이트박스로 연 파일 — 노드가 바뀌면 닫힌다
  const [opened, setOpened] = useState<{ node: string; id: string } | null>(null);
  const openId = opened?.node === nodeId ? opened.id : null;
  const setOpenId = useCallback((id: string | null) => setOpened(id ? { node: nodeId, id } : null), [nodeId]);
  const refresh = useCallback(
    (fileId: string) => {
      const f = files?.find((x) => x.id === fileId);
      if (f) void sign([f]);
    },
    [files, sign],
  );

  const resolver = useMemo<ImageResolver>(
    () => ({
      resolve(name) {
        if (!files) return { state: "loading" };
        const f = files.findLast((x) => x.name === name);
        if (!f || !isImageMime(f.contentType)) return { state: "missing" };
        if (!urls.has(f.id)) return { state: "loading" };
        const url = urls.get(f.id);
        // 서명을 못 받은 그림(경로 없음·Storage 오류)은 없는 것과 같게 보인다
        return url ? { state: "ok", fileId: f.id, url, svg: isSvgMime(f.contentType) } : { state: "missing" };
      },
      open: setOpenId,
      refresh,
    }),
    [files, urls, setOpenId, refresh],
  );

  return { files: files ?? [], setFiles, resolver, urls, refresh, openId, setOpenId };
}
