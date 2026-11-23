import { useEffect, useRef, useState } from 'preact/hooks';
import { X, Images, SwitchCamera } from 'lucide-preact';
import { cam, closeCamera, deliverFiles } from './camera';
import { useLinger } from './components';

export function CameraView() {
  const open = cam.use((s) => s.open);
  const show = useLinger(open, 350);
  const vid = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const galRef = useRef<HTMLInputElement>(null);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState('');
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [flash, setFlash] = useState(false);

  const stop = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (vid.current) vid.current.srcObject = null;
    setReady(false);
  };

  useEffect(() => {
    if (!open) { stop(); return; }
    let dead = false;
    setErr('');
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('nocam');
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false });
        if (dead) { s.getTracks().forEach((t) => t.stop()); return; }
        stream.current = s;
        const v = vid.current;
        if (v) { v.srcObject = s; await v.play().catch(() => undefined); }
        setReady(true);
      } catch (e) {
        const name = (e as Error).name;
        setErr(name === 'NotAllowedError' ? 'אין הרשאה למצלמה. אפשר לאשר אותה בהגדרות של האייפון, או לבחור תמונה מהגלריה.' : 'לא הצלחתי לפתוח את המצלמה. אפשר לבחור תמונה מהגלריה.');
      }
    })();
    const onHide = () => { if (document.visibilityState !== 'visible') closeCamera(); };
    document.addEventListener('visibilitychange', onHide);
    return () => { dead = true; document.removeEventListener('visibilitychange', onHide); stop(); };
  }, [open, facing]);

  const shoot = () => {
    const v = vid.current;
    if (!v || !ready || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d')?.drawImage(v, 0, 0, c.width, c.height);
    setFlash(true);
    setTimeout(() => setFlash(false), 140);
    c.toBlob((b) => { if (b) deliverFiles([new File([b], 'photo.jpg', { type: 'image/jpeg' })]); }, 'image/jpeg', 0.9);
  };
  const onGallery = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const picked = [...(input.files ?? [])];
    input.value = '';
    deliverFiles(picked);
  };

  if (!show) return null;
  return (
    <div class={'cam' + (open ? ' on' : '')} role="dialog" aria-label="מצלמה">
      <video ref={vid} class={ready ? 'rd' : ''} playsInline muted autoplay />
      {err && <div class="cam-err">{err}</div>}
      <div class={'cam-fl' + (flash ? ' on' : '')} />
      <button class="cam-x" aria-label="סגור מצלמה" onClick={closeCamera}><X /></button>
      <div class="cam-bar">
        <button class="cam-s" aria-label="גלריה" onClick={() => galRef.current?.click()}><Images /></button>
        <button class="cam-shot" aria-label="צלם" onClick={shoot} disabled={!ready}><span /></button>
        <button class="cam-s" aria-label="הפוך מצלמה" onClick={() => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))}><SwitchCamera /></button>
      </div>
      <input ref={galRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={onGallery} />
    </div>
  );
}
