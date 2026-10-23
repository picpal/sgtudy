/** 그림으로 보는 첨부 종류 — 0045 node_image_mime_types() 와 같은 목록 (md-images 스펙 D12). SVG 는 0045 전까지 올릴 수 없다 */
export const IMAGE_MIME = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"] as const;
export type ImageMime = (typeof IMAGE_MIME)[number];

export const isImageMime = (m: string): m is ImageMime => (IMAGE_MIME as readonly string[]).includes(m);
export const isSvgMime = (m: string) => m === "image/svg+xml";
