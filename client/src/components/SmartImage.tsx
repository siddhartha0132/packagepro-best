import { useEffect, useState } from "react";

/** Destination photo that shimmers while loading, fades in when fully decoded, and falls back to the generated artwork on error. */
export function SmartImage({ src, fallback, alt, className = "", eager = false }: { src: string; fallback?: string; alt: string; className?: string; eager?: boolean }) {
  const [current, setCurrent] = useState(src);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { setCurrent(src); setLoaded(false); }, [src]);
  return <>
    {!loaded && <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-[#dfe8f4] via-[#eef3fa] to-[#d3deee]" />}
    <img
      src={current}
      alt={alt}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      onLoad={() => setLoaded(true)}
      onError={() => { if (fallback && current !== fallback) setCurrent(fallback); else setLoaded(true); }}
      className={`h-full w-full object-cover transition-[opacity,transform] duration-700 ${loaded ? "opacity-100" : "opacity-0"} ${className}`}
    />
  </>;
}
