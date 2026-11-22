/** מכווץ תמונה לפני שליחה ל-AI: עד 1280 פיקסלים, JPEG איכות 0.82 (מהיר וזול יותר, ומספיק לזיהוי אוכל ותוויות) */
export async function fileToJpeg(file: File, max = 1024): Promise<{ url: string; data: string; mime: string }> {
  const src = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('לא הצלחתי לקרוא את התמונה'));
      i.src = src;
    });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d')!.drawImage(img, 0, 0, w, h);
    const dataUrl = c.toDataURL('image/jpeg', 0.78);
    return { url: dataUrl, data: dataUrl.split(',')[1], mime: 'image/jpeg' };
  } finally {
    URL.revokeObjectURL(src);
  }
}

const readB64 = (f: File) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] ?? '');
    r.onerror = () => rej(new Error('קריאת הקובץ נכשלה'));
    r.readAsDataURL(f);
  });

/** קובץ לצירוף בצ'אט: תמונה מכווצת, או PDF כמו שהוא (עד 8MB) */
export async function fileToAttachment(f: File): Promise<{ url?: string; data: string; mime: string; name: string }> {
  const isPdf = f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf');
  if (isPdf) {
    if (f.size > 8 * 1024 * 1024) throw new Error('קובץ ה-PDF גדול מדי (עד 8MB)');
    return { data: await readB64(f), mime: 'application/pdf', name: f.name };
  }
  const j = await fileToJpeg(f);
  return { ...j, name: f.name };
}
