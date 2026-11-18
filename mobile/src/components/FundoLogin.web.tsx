import { useEffect, useRef, useState } from 'react';

/**
 * Fundo da tela de login no webapp: vídeo de introdução (usinas → eletroposto
 * → apartamento), mudo e em laço, gerado no Gemini Omni Flash.
 * - Arquivos em public/fundo/ (fora do bundle; nome com versão para o cache).
 * - Retrato usa o corte 9:16, paisagem o 16:9.
 * - Pôster aparece na hora; o vídeo entra por cima com fade quando começa a tocar.
 * - "Reduzir movimento" ou "Economia de dados" no aparelho: só o pôster.
 */
const V = '1';
const ARQ = {
  h: { video: `/fundo/intro-h-${V}.mp4`, poster: `/fundo/intro-h-${V}.jpg` },
  v: { video: `/fundo/intro-v-${V}.mp4`, poster: `/fundo/intro-v-${V}.jpg` },
};

const consulta = (q: string) => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q) : null);

function useMedia(q: string) {
  const [ok, setOk] = useState(() => consulta(q)?.matches ?? false);
  useEffect(() => {
    const m = consulta(q);
    if (!m) return;
    const f = () => setOk(m.matches);
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, [q]);
  return ok;
}

export function FundoLogin() {
  const retrato = useMedia('(orientation: portrait)');
  const semMovimento = useMedia('(prefers-reduced-motion: reduce)');
  const economia = typeof navigator !== 'undefined' && Boolean((navigator as { connection?: { saveData?: boolean } }).connection?.saveData);
  const arq = retrato ? ARQ.v : ARQ.h;
  const ref = useRef<HTMLVideoElement>(null);
  // Qual arquivo já começou a tocar: trocar de orientação volta ao pôster até o novo tocar.
  const [tocou, setTocou] = useState<string | null>(null);
  const tocando = tocou === arq.video;
  const comVideo = !semMovimento && !economia;

  // Aba em segundo plano: pausa (bateria); ao voltar, segue de onde parou.
  useEffect(() => {
    if (!comVideo) return;
    const f = () => {
      const v = ref.current;
      if (!v) return;
      if (document.hidden) v.pause();
      else v.play().catch(() => {});
    };
    document.addEventListener('visibilitychange', f);
    return () => document.removeEventListener('visibilitychange', f);
  }, [comVideo]);

  return (
    <div aria-hidden="true" style={estilo.raiz}>
      <img src={arq.poster} alt="" style={estilo.midia} decoding="async" fetchPriority="high" />
      {comVideo ? (
        <video
          key={arq.video}
          ref={ref}
          src={arq.video}
          poster={arq.poster}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          disablePictureInPicture
          onPlaying={() => setTocou(arq.video)}
          style={{ ...estilo.midia, opacity: tocando ? 1 : 0, transition: 'opacity 1.2s cubic-bezier(0.16, 1, 0.3, 1)' }}
        />
      ) : null}
      {/* Véu: escurece o topo e a base e segura o contraste do texto claro
          no centro sem apagar o vídeo. */}
      <div style={estilo.veu} />
    </div>
  );
}

const estilo = {
  raiz: { position: 'fixed', inset: 0, overflow: 'hidden', backgroundColor: '#0B1124', zIndex: 0 },
  midia: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: '50% 50%' },
  veu: {
    position: 'absolute',
    inset: 0,
    backgroundImage: [
      'radial-gradient(ellipse 60% 70% at 50% 50%, rgba(7,10,30,0.40) 0%, rgba(7,10,30,0.12) 60%, rgba(7,10,30,0) 100%)',
      'linear-gradient(180deg, rgba(7,10,30,0.55) 0%, rgba(7,10,30,0.16) 28%, rgba(7,10,30,0.20) 62%, rgba(7,10,30,0.74) 100%)',
    ].join(', '),
  },
} as const satisfies Record<string, React.CSSProperties>;
