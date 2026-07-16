interface WireframeCubeProps {
  size?: number
  className?: string
}

export function WireframeCube({ size = 32, className = '' }: WireframeCubeProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <g stroke="var(--accent)" strokeWidth="1" strokeLinecap="square">
        <line className="wireframe-cube-edge" x1="8" y1="14" x2="16" y2="10" />
        <line className="wireframe-cube-edge" x1="16" y1="10" x2="24" y2="14" />
        <line className="wireframe-cube-edge" x1="24" y1="14" x2="24" y2="22" />
        <line className="wireframe-cube-edge" x1="24" y1="22" x2="16" y2="26" />
        <line className="wireframe-cube-edge" x1="16" y1="26" x2="8" y2="22" />
        <line className="wireframe-cube-edge" x1="8" y1="22" x2="8" y2="14" />
        <line className="wireframe-cube-edge" x1="8" y1="14" x2="16" y2="18" />
        <line className="wireframe-cube-edge" x1="16" y1="18" x2="24" y2="14" />
        <line className="wireframe-cube-edge" x1="16" y1="18" x2="16" y2="26" />
        <line className="wireframe-cube-edge" x1="8" y1="22" x2="16" y2="18" />
        <line className="wireframe-cube-edge" x1="24" y1="22" x2="16" y2="18" />
        <line className="wireframe-cube-edge" x1="16" y1="10" x2="16" y2="18" />
      </g>
      <polygon
        className="wireframe-cube-face"
        points="16,10 24,14 16,18 8,14"
        fill="var(--accent)"
        fillOpacity="0.08"
        stroke="none"
      />
    </svg>
  )
}
