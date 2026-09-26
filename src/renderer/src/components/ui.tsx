/**
 * O trio de controles unificado: Switch (chave booleana) / Segmented (escolha entre faixas) / ToggleChip
 * (a cápsula de chave com ícone). Antes conviviam três linguagens visuais de chave (uma pill desenhada à mão,
 * um chip com borda destacada, um ponto de rádio), e aqui tudo converge para uma só — booleano usa Switch,
 * várias faixas usam Segmented, e um chip que cicla a cada clique não se disfarça mais de chave.
 */
import { createPortal } from "react-dom";
import { useEffect } from "react";

/** Chave booleana (o gradiente da marca = ligada). */
export function Switch({ on, disabled, onToggle }: { on: boolean; disabled?: boolean; onToggle: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onToggle}
      className={`relative h-4.5 w-8 shrink-0 rounded-full transition-colors disabled:opacity-35 ${on ? "flame-gradient" : "bg-line"}`}
    >
      <span className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-all ${on ? "left-4" : "left-0.5"}`} />
    </button>
  );
}

/** Uma linha de chave: o rótulo à esquerda (com explicação, se houver) e o Switch à direita. */
export function SwitchRow({
  label,
  hint,
  on,
  disabled,
  disabledHint,
  onToggle,
}: {
  label: string;
  hint?: string;
  on: boolean;
  disabled?: boolean;
  /** O motivo do cinza (por que isto não dá para ligar agora). */
  disabledHint?: string;
  onToggle: () => void;
}): React.JSX.Element {
  return (
    <div className={`flex min-h-7.5 items-center gap-2.5 ${disabled ? "opacity-55" : ""}`} title={disabled ? disabledHint : hint}>
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg/90">
        {label}
        {hint && <span className="ml-2 text-[10.5px] text-mut/70">{disabled && disabledHint ? disabledHint : hint}</span>}
      </span>
      <Switch on={on} disabled={disabled} onToggle={onToggle} />
    </div>
  );
}

/** O controle segmentado de várias faixas (no lugar do «clicar para ciclar» — as faixas se veem de relance, sem precisar clicar contando). */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  disabled,
  ariaLabel,
}: {
  value: T;
  options: Array<{ value: T; label: string; title?: string }>;
  onChange: (v: T) => void;
  disabled?: boolean;
  ariaLabel?: string;
}): React.JSX.Element {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={`flex max-w-full shrink-0 flex-wrap overflow-hidden rounded-lg border border-line ${disabled ? "opacity-40" : ""}`}
    >
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          title={o.title}
          aria-pressed={o.value === value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={`px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap transition-colors ${
            o.value === value ? "bg-ember/15 text-ember" : "text-mut hover:text-fg"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** O título de uma subseção (o cabeçalho de um grupo dentro dos painéis da bancada). */
export function SectionLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="text-[10.5px] font-bold tracking-[1.5px] text-mut/70">{children}</div>;
}

/**
 * A casca do modal: portal para o body + fechar com Esc + fechar clicando na máscara.
 * O portal resolveu aquela classe de armadilha de containing-block em que o transform do rise-in fazia o
 * posicionamento fixed deixar de funcionar (sem depender mais de uma cadeia de ancestrais limpa); e o Esc
 * deixou de existir «só na mesa de revisão» para existir em todo lugar.
 */
export function ModalShell({ onClose, children }: { onClose: () => void; children: React.ReactNode }): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div data-hotclip-modal="true" onClick={onClose} className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm">
      {children}
    </div>,
    document.body
  );
}
