import { useEffect, useRef } from 'react';

/** Canvas visualizer with smoothed emerald waveform bars */
export default function Visualizer({ levelRef, mode }) {
  const ref = useRef(null);
  const hist = useRef(new Array(44).fill(0));

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const g = c.getContext('2d');
    let raf;
    let t = 0;

    const draw = () => {
      t += 1;
      const h = hist.current;
      let v = 0;
      if (mode === 'user') {
        v = Math.min(1, (levelRef.current || 0) * 14);
      } else if (mode === 'ai') {
        v = 0.25 + 0.35 * Math.abs(Math.sin(t / 5)) * (0.6 + 0.4 * Math.sin(t / 2.3));
      }
      h.push(v);
      h.shift();

      g.clearRect(0, 0, c.width, c.height);

      // Canvas background
      g.fillStyle = '#070b08';
      g.fillRect(0, 0, c.width, c.height);

      const color =
        mode === 'user' ? '#10b981' : mode === 'ai' ? '#34d399' : '#1a291f';

      const bw = c.width / h.length;
      h.forEach((x, i) => {
        const bh = Math.max(3, x * (c.height - 8));
        const px = i * bw + 1.5;
        const py = (c.height - bh) / 2;
        const pw = Math.max(1, bw - 2.5);

        g.fillStyle = color;
        // Rounded capsule bars
        if (g.roundRect) {
          g.beginPath();
          g.roundRect(px, py, pw, bh, 2);
          g.fill();
        } else {
          g.fillRect(px, py, pw, bh);
        }
      });

      raf = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(raf);
  }, [mode, levelRef]);

  return (
    <div className="overflow-hidden rounded-[6px] border border-[#16231a] bg-[#070b08]">
      <canvas
        ref={ref}
        width={320}
        height={52}
        className="w-full block"
        aria-label="Voice activity waveform"
      />
    </div>
  );
}
