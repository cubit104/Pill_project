'use client'

import { useState } from 'react'

/** A pill photo that zooms 2.5x under the mouse, so the imprint can be read off it. */
export default function ZoomImage({ src, alt, className = '' }: { src: string; alt: string; className?: string }) {
  const [lens, setLens] = useState<{ x: number; y: number } | null>(null)
  return (
    <div
      className="relative cursor-zoom-in overflow-hidden rounded-lg border border-gray-200 bg-gray-100"
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        setLens({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 })
      }}
      onMouseLeave={() => setLens(null)}
    >
      <img
        src={src}
        alt={alt}
        loading="lazy"
        className={`w-full object-contain ${className}`}
        style={lens ? { transform: 'scale(2.5)', transformOrigin: `${lens.x}% ${lens.y}%` } : undefined}
      />
    </div>
  )
}
