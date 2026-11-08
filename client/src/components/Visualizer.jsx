import { useEffect, useRef } from 'react';

/** Bars driven by mic level (user) or a synthetic pulse (AI speaking; SpeechSynthesis exposes no audio level). */
export default function Visualizer({ levelRef, mode }) {
  const ref = useRef(null);
  const hist = useRef(new Array(40).fill(0));

  useEffect(() => {
    const c = ref.current;
    const g = c.getContext('2d');
    let raf;
    let t = 0;
    const draw = () => {
      t += 1;
      const h = hist.current;
      let v = 0;
      if (mode === 'user') v = Math.min(1, (levelRef.current || 0) * 14);
      else if (mode === 'ai') v = 0.25 + 0.35 * Math.abs(Math.sin(t / 5)) * (0.6 + 0.4 * Math.sin(t / 2.3));
      h.push(v);
      h.shift();
      g.clearRect(0, 0, c.width, c.height);
      g.fillStyle = mode === 'user' ? '#34d399' : mode === 'ai' ? '#60a5fa' : '#404040';
      const bw = c.width / h.length;
      h.forEach((x, i) => {
        const bh = Math.max(2, x * c.height);
        g.fillRect(i * bw + 1, (c.height - bh) / 2, bw - 2, bh);
      });
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [mode, levelRef]);

  return <canvas ref={ref} width={320} height={56} className="w-full" aria-label="Voice activity" />;
}
