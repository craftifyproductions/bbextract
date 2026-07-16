interface EmptyStateProps {
  children?: React.ReactNode
  centered?: boolean
}

export function EmptyState({ children, centered = false }: EmptyStateProps) {
  return (
    <div
      className={
        centered
          ? 'flex min-h-[calc(100vh-12rem)] flex-col items-center justify-center text-center'
          : 'mx-auto w-full max-w-xl'
      }
    >
      <div className={`mb-8 ${centered ? 'max-w-md' : 'border-b border-border pb-6'}`}>
        <h2 className="text-lg font-semibold text-text-primary">No models extracted yet</h2>
        <p className="mt-2 text-sm leading-relaxed text-text-secondary">
          Drop Blockbench .bbmodel files to extract textures, geometry, bones, and animations.
          All processing runs locally in your browser.
        </p>
      </div>
      <div className={centered ? 'flex w-full max-w-xl justify-center' : ''}>{children}</div>
    </div>
  )
}
