import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { RagLabelModelOption } from '../../lib/ragBatchApi'

export interface ModelPickerGroup {
  label: string
  ids: string[]
}

interface ModelPickerProps {
  value: string
  groups: ModelPickerGroup[]
  options: RagLabelModelOption[]
  disabled?: boolean
  onChange: (modelId: string) => void
  fallbackLabel?: string
}

type ProviderIconKey =
  | 'google'
  | 'anthropic'
  | 'openai'
  | 'nvidia'
  | 'meta'
  | 'qwen'
  | 'xiaomi'
  | 'minimax'
  | 'stepfun'
  | 'openrouter'

const PROVIDER_ICON: Record<
  ProviderIconKey,
  { src: string; tone: string; label: string }
> = {
  google: {
    src: '/provider-icons/google.svg',
    tone: 'bg-[#8E75B2]/15',
    label: 'Google',
  },
  anthropic: {
    src: '/provider-icons/anthropic.svg',
    tone: 'bg-[#D4A27F]/15',
    label: 'Anthropic',
  },
  openai: {
    src: '/provider-icons/openai.svg',
    tone: 'bg-white/10',
    label: 'OpenAI',
  },
  nvidia: {
    src: '/provider-icons/nvidia.svg',
    tone: 'bg-[#76B900]/15',
    label: 'NVIDIA',
  },
  meta: {
    src: '/provider-icons/meta.svg',
    tone: 'bg-[#0866FF]/15',
    label: 'Meta',
  },
  qwen: {
    src: '/provider-icons/qwen.svg',
    tone: 'bg-[#6A3DE8]/15',
    label: 'Qwen',
  },
  xiaomi: {
    src: '/provider-icons/xiaomi.svg',
    tone: 'bg-[#FF6900]/15',
    label: 'Xiaomi',
  },
  minimax: {
    src: '/provider-icons/minimax.svg',
    tone: 'bg-[#E0A020]/15',
    label: 'MiniMax',
  },
  stepfun: {
    src: '/provider-icons/stepfun.svg',
    tone: 'bg-accent/15',
    label: 'StepFun',
  },
  openrouter: {
    src: '/provider-icons/openrouter.svg',
    tone: 'bg-[#94A3B8]/15',
    label: 'OpenRouter',
  },
}

function providerKey(modelId: string): ProviderIconKey {
  // NIM-hosted Gemma still uses the Google icon; NIM Llama Scout uses Meta.
  if (modelId.startsWith('nvidia/')) return 'nvidia'
  if (modelId.startsWith('google/')) return 'google'
  if (modelId.startsWith('anthropic/')) return 'anthropic'
  if (modelId.startsWith('openai/')) return 'openai'
  if (modelId.startsWith('meta-llama/') || modelId.startsWith('meta/')) return 'meta'
  if (modelId.startsWith('qwen/')) return 'qwen'
  if (modelId.startsWith('xiaomi/')) return 'xiaomi'
  if (modelId.startsWith('minimax/')) return 'minimax'
  if (modelId.startsWith('stepfun/')) return 'stepfun'
  return 'openrouter'
}

function ProviderIcon({ modelId, size = 'md' }: { modelId: string; size?: 'sm' | 'md' }) {
  const key = providerKey(modelId)
  const meta = PROVIDER_ICON[key]
  const box = size === 'sm' ? 'h-7 w-7' : 'h-8 w-8'
  const img = size === 'sm' ? 'h-4 w-4' : 'h-[18px] w-[18px]'

  return (
    <span
      className={`inline-flex ${box} shrink-0 items-center justify-center rounded-md ${meta.tone}`}
      title={meta.label}
    >
      <img
        src={meta.src}
        alt=""
        aria-hidden="true"
        className={`${img} object-contain`}
        loading="lazy"
        decoding="async"
      />
    </span>
  )
}

export function ModelPicker({
  value,
  groups,
  options,
  disabled = false,
  onChange,
  fallbackLabel = 'Select a model',
}: ModelPickerProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  const selected = useMemo(
    () => options.find((option) => option.id === value) ?? null,
    [options, value],
  )

  const grouped = useMemo(
    () =>
      groups
        .map((group) => ({
          ...group,
          options: options.filter((option) => group.ids.includes(option.id)),
        }))
        .filter((group) => group.options.length > 0),
    [groups, options],
  )

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  return (
    <div ref={rootRef} className="relative min-w-[min(100%,280px)] flex-1 sm:max-w-md">
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-text-secondary">
        Label model
      </p>

      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((prev) => !prev)}
        className={`group flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-all duration-200 ${
          open
            ? 'border-accent/55 bg-surface-elevated shadow-[0_0_0_1px_rgba(74,127,212,0.18)]'
            : 'border-border bg-surface-base/80 hover:border-accent/35 hover:bg-surface-elevated/80'
        } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
      >
        <ProviderIcon modelId={value} size="md" />

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-text-primary">
              {selected?.label ?? fallbackLabel}
            </span>
            {value.includes(':free') || selected?.priceLabel === 'Free' ? (
              <span className="rounded bg-accent-warm/15 px-1.5 py-0.5 font-mono text-[10px] text-accent-warm">
                free
              </span>
            ) : selected?.priceLabel ? (
              <span className="rounded bg-surface-elevated px-1.5 py-0.5 font-mono text-[10px] text-text-secondary">
                {selected.priceLabel}
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 block truncate font-mono text-[10px] text-text-secondary">
            {selected?.id ?? value}
            {selected?.priceLabel && selected.priceLabel !== 'Free'
              ? ' · $/1M in / out'
              : ''}
          </span>
        </span>

        <svg
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden="true"
          className={`h-4 w-4 shrink-0 text-text-secondary transition-transform duration-200 ${
            open ? 'rotate-180 text-accent' : 'group-hover:text-text-primary'
          }`}
        >
          <path
            d="M5 7.5L10 12.5L15 7.5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open ? (
        <div
          id={listId}
          role="listbox"
          aria-label="OpenRouter vision models"
          className="absolute z-40 mt-2 max-h-80 w-full overflow-y-auto rounded-xl border border-border bg-surface-elevated/98 p-1.5 shadow-[0_18px_50px_rgba(0,0,0,0.45)] backdrop-blur-sm"
        >
          {grouped.length === 0 ? (
            <p className="px-3 py-4 text-xs text-text-secondary">No models available</p>
          ) : (
            grouped.map((group) => (
              <div key={group.label} className="mb-1 last:mb-0">
                <p className="px-2.5 pb-1 pt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary/70">
                  {group.label.replace(/^OpenRouter ·\s*/, '')}
                </p>
                <div className="space-y-0.5">
                  {group.options.map((option) => {
                    const active = option.id === value
                    const unavailable = option.configured === false
                    return (
                      <button
                        key={option.id}
                        type="button"
                        role="option"
                        aria-selected={active}
                        disabled={unavailable}
                        onClick={() => {
                          onChange(option.id)
                          setOpen(false)
                        }}
                        className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                          active
                            ? 'bg-accent/15 ring-1 ring-accent/35'
                            : 'hover:bg-surface-base/80'
                        } ${unavailable ? 'cursor-not-allowed opacity-45' : ''}`}
                      >
                        <ProviderIcon modelId={option.id} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="text-sm text-text-primary">{option.label}</span>
                            {option.priceLabel === 'Free' || option.id.includes(':free') ? (
                              <span className="rounded bg-accent-warm/15 px-1.5 py-0.5 font-mono text-[10px] text-accent-warm">
                                free
                              </span>
                            ) : option.priceLabel ? (
                              <span className="rounded bg-surface-base px-1.5 py-0.5 font-mono text-[10px] text-emerald-300/90">
                                {option.priceLabel}
                              </span>
                            ) : null}
                            {unavailable ? (
                              <span className="font-mono text-[10px] text-amber-300">no key</span>
                            ) : null}
                            {active ? (
                              <span className="ml-auto font-mono text-[10px] text-accent">selected</span>
                            ) : null}
                          </span>
                          <span className="mt-0.5 block text-[11px] leading-snug text-text-secondary">
                            {option.hint}
                          </span>
                          <span className="mt-1 block font-mono text-[10px] text-text-secondary/75">
                            {option.priceLabel
                              ? option.priceLabel === 'Free'
                                ? 'Free on OpenRouter'
                                : `${option.priceLabel} per 1M tokens (in / out)`
                              : null}
                            {option.priceLabel && option.rpm != null ? ' · ' : null}
                            {option.rpm != null
                              ? `${option.rpm} RPM · ${option.rpd?.toLocaleString()} RPD`
                              : null}
                          </span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      ) : null}

      <p className="mt-1.5 text-[10px] leading-relaxed text-text-secondary/85">
        {selected
          ? `${selected.hint}${
              selected.rpm != null
                ? ` · caps ${selected.rpm} RPM / ${selected.tpm?.toLocaleString()} TPM / ${selected.rpd?.toLocaleString()} RPD`
                : ''
            }`
          : 'Used to generate label.json'}
      </p>
    </div>
  )
}
