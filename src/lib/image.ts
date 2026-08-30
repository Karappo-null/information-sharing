export const MAX_IMAGE_COUNT = 4;
const MAX_INPUT_BYTES = 5 * 1024 * 1024;
const MAX_LONG_EDGE = 1920;
const WEBP_QUALITY = 0.82;
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
export type PreparedImage = { file: File; width: number; height: number };

export async function prepareImage(source: File): Promise<PreparedImage> {
  if (!ACCEPTED_TYPES.has(source.type)) throw new Error("画像はJPEG、PNG、WebPのみ選択できます。");
  if (source.size > MAX_INPUT_BYTES) throw new Error("画像は1枚5MB以下にしてください。");
  const objectUrl = URL.createObjectURL(source);
  try {
    const image = await loadImage(objectUrl);
    const scale = Math.min(1, MAX_LONG_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale)); const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d"); if (!context) throw new Error("画像を処理できませんでした。");
    context.drawImage(image, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", WEBP_QUALITY));
    if (!blob) throw new Error("画像をWebPへ変換できませんでした。");
    if (blob.size > MAX_INPUT_BYTES) throw new Error("縮小後の画像が5MBを超えています。別の画像を選択してください。");
    return { file: new File([blob], `${source.name.replace(/\.[^.]+$/, "") || "image"}.webp`, { type: "image/webp" }), width, height };
  } finally { URL.revokeObjectURL(objectUrl); }
}
function loadImage(src: string): Promise<HTMLImageElement> { return new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error("画像を読み込めませんでした。")); image.src = src; }); }
