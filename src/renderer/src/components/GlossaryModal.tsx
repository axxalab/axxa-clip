/**
 * Gestão do vocabulário de termos: acrescentar, remover e procurar os pares «termo errado → termo certo». O
 * vocabulário fica guardado nesta máquina e, quando a transcrição termina, a palavra inteira é substituída em
 * todo o material (o mesmo para o desktop, o MCP e o vigia de gravações) — a gíria de quem apresenta, o nome
 * da marca e o nome das pessoas são cadastrados uma vez e corrigidos sozinhos em todos os episódios seguintes.
 */
import { useEffect, useState } from "react";
import { LuBookOpen, LuX, LuPlus, LuTrash2, LuArrowRight } from "react-icons/lu";
import { useT } from "../i18n/store";
import { getApi } from "../api/provider";
import type { GlossaryEntry } from "../../../shared/api-types";
import { upsertGlossaryEntry, sanitizeGlossary } from "../../../shared/glossary";
import { ModalShell } from "./ui";

export function GlossaryModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const t = useT("glossary");
  const [entries, setEntries] = useState<GlossaryEntry[] | null>(null);
  const [wrong, setWrong] = useState("");
  const [right, setRight] = useState("");

  useEffect(() => {
    void getApi()
      .glossaryGet()
      .then(setEntries)
      .catch(() => setEntries([]));
  }, []);

  const persist = (next: GlossaryEntry[]): void => {
    setEntries(next);
    void getApi().glossarySet(next);
  };

  const add = (): void => {
    const entry = sanitizeGlossary([{ wrong, right }]);
    if (entry.length === 0 || !entries) return;
    persist(upsertGlossaryEntry(entries, entry[0]));
    setWrong("");
    setRight("");
  };

  const remove = (key: string): void => {
    if (!entries) return;
    persist(entries.filter((e) => e.wrong !== key));
  };

  return (
    <ModalShell onClose={onClose}>
      <section
        className="card w-full max-w-xl rounded-2xl p-6"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={t("title")}
      >
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-extrabold">
            <LuBookOpen className="h-5 w-5 text-ember" />
            {t("title")}
          </h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-mut transition-colors hover:text-fg" aria-label="close">
            <LuX className="h-4.5 w-4.5" />
          </button>
        </div>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-mut">{t("desc")}</p>

        {/* Nova entrada */}
        <div className="mt-4 flex items-center gap-2">
          <input
            value={wrong}
            onChange={(e) => setWrong(e.target.value)}
            placeholder={t("wrongPlaceholder")}
            className="min-w-0 flex-1 rounded-lg border border-line bg-panel-2 px-3 py-2 text-[13px] outline-none focus:border-ember/60"
          />
          <LuArrowRight className="h-4 w-4 shrink-0 text-mut" />
          <input
            value={right}
            onChange={(e) => setRight(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
            }}
            placeholder={t("rightPlaceholder")}
            className="min-w-0 flex-1 rounded-lg border border-line bg-panel-2 px-3 py-2 text-[13px] outline-none focus:border-ember/60"
          />
          <button
            type="button"
            onClick={add}
            disabled={!wrong.trim() || !right.trim() || wrong.trim() === right.trim()}
            className="btn-flame inline-flex shrink-0 items-center gap-1 rounded-lg px-3.5 py-2 text-[13px] font-bold text-white disabled:opacity-40"
          >
            <LuPlus className="h-3.5 w-3.5" />
            {t("add")}
          </button>
        </div>

        {/* Lista de entradas */}
        <div className="mt-4 max-h-[40vh] overflow-y-auto rounded-xl border border-line">
          {entries === null ? (
            <p className="p-4 text-center text-[12.5px] text-mut">…</p>
          ) : entries.length === 0 ? (
            <p className="p-4 text-center text-[12.5px] text-mut">{t("empty")}</p>
          ) : (
            entries.map((e) => (
              <div
                key={e.wrong}
                className="group/entry flex items-center gap-3 border-b border-line/50 px-4 py-2.5 text-[13px] last:border-b-0"
              >
                <span className="min-w-0 flex-1 truncate text-mut line-through decoration-red-400/60">{e.wrong}</span>
                <LuArrowRight className="h-3.5 w-3.5 shrink-0 text-mut/60" />
                <span className="min-w-0 flex-1 truncate font-semibold">{e.right}</span>
                <button
                  type="button"
                  title={t("remove")}
                  onClick={() => remove(e.wrong)}
                  className="shrink-0 rounded p-1 text-mut opacity-0 transition-opacity group-hover/entry:opacity-100 hover:text-red-400"
                >
                  <LuTrash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </div>

        <p className="mt-3 text-[11.5px] leading-relaxed text-mut/80">{t("hint")}</p>
      </section>
    </ModalShell>
  );
}
