"use client";

import { useState } from "react";
import { PlusCircle, Loader2, CheckCircle2, X, Upload, Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tabs, type Tab } from "@/components/ui/tabs";
import { toast } from "sonner";

const TABS_LIST: Tab[] = [
  { id: "uniquebox", label: "UniqueBox" },
  { id: "uniquekids", label: "UniqueKids" },
];

const MAX_MENSAGENS = 28;
const MAX_BLOCOS = 30;

type ResultPayload = {
  lote_id: string;
  total_pedidos: number;
  arquivos?: Array<{ id: string; tipo: string; nome: string; url: string }>;
};

export default function AvulsoPage() {
  const [activeTab, setActiveTab] = useState("uniquebox");

  return (
    <div className="space-y-4 animate-fade-in">
      <h1 className="text-lg font-semibold text-ink">Pedido Avulso</h1>
      <Tabs tabs={TABS_LIST} activeTab={activeTab} onChange={setActiveTab} />

      <div className="max-w-2xl">
        {activeTab === "uniquebox" ? <UniqueBoxForm /> : <UniqueKidsForm />}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// UniqueBox: Chapa OR Bloco
// ──────────────────────────────────────────────

function UniqueBoxForm() {
  const [modo, setModo] = useState<"chapa" | "bloco">("chapa");

  return (
    <div className="space-y-3">
      <div className="flex gap-1 rounded-lg border border-line bg-surface p-1 w-fit">
        {(["chapa", "bloco"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setModo(m)}
            className={cn(
              "px-4 py-1.5 rounded-md text-xs font-medium capitalize transition-all",
              modo === m
                ? "bg-paper text-ink shadow-sm"
                : "text-ink-muted hover:text-ink"
            )}
          >
            {m}
          </button>
        ))}
      </div>

      {modo === "chapa" ? <UniqueBoxChapaForm /> : <UniqueBoxBlocoForm />}
    </div>
  );
}

// ──────────────────────────────────────────────
// UniqueBox — Chapa (mensagens)
// ──────────────────────────────────────────────

type Mensagem = { cliente: string; linha1: string; linha2: string; linha3: string };

function UniqueBoxChapaForm() {
  const [mensagens, setMensagens] = useState<Mensagem[]>([
    { cliente: "", linha1: "", linha2: "", linha3: "" },
  ]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ResultPayload | null>(null);

  const update = (i: number, patch: Partial<Mensagem>) =>
    setMensagens((prev) => prev.map((m, j) => (j === i ? { ...m, ...patch } : m)));

  const add = () =>
    setMensagens((prev) =>
      prev.length < MAX_MENSAGENS
        ? [...prev, { cliente: "", linha1: "", linha2: "", linha3: "" }]
        : prev
    );

  const remove = (i: number) =>
    setMensagens((prev) => (prev.length === 1 ? prev : prev.filter((_, j) => j !== i)));

  const valid = mensagens.every((m) => m.cliente.trim());

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/avulso/uniquebox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo: "chapa",
          mensagens: mensagens.map((m) => ({
            cliente: m.cliente.trim(),
            linha1: m.linha1,
            linha2: m.linha2,
            linha3: m.linha3,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro");
      setResult(data);
      toast.success(`${data.total_pedidos} pedido(s) criado(s)`);
      setMensagens([{ cliente: "", linha1: "", linha2: "", linha3: "" }]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-line bg-paper p-5 shadow-sm space-y-4"
    >
      <SectionHeader
        bullet="bg-uniquebox"
        title="UniqueBox — Chapa"
        count={`${mensagens.length}/${MAX_MENSAGENS}`}
      />

      <div className="space-y-3">
        {mensagens.map((m, i) => (
          <EntryCard key={i} index={i} onRemove={mensagens.length > 1 ? () => remove(i) : undefined}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <FormField label="Cliente" required>
                <input
                  type="text"
                  value={m.cliente}
                  onChange={(e) => update(i, { cliente: e.target.value })}
                  placeholder="Nome do cliente"
                  className={inputCls}
                  required
                />
              </FormField>
              <FormField label="Linha 1">
                <input
                  type="text"
                  value={m.linha1}
                  onChange={(e) => update(i, { linha1: e.target.value })}
                  className={inputCls}
                />
              </FormField>
              <FormField label="Linha 2">
                <input
                  type="text"
                  value={m.linha2}
                  onChange={(e) => update(i, { linha2: e.target.value })}
                  className={inputCls}
                />
              </FormField>
              <FormField label="Linha 3">
                <input
                  type="text"
                  value={m.linha3}
                  onChange={(e) => update(i, { linha3: e.target.value })}
                  className={inputCls}
                />
              </FormField>
            </div>
          </EntryCard>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={add}
          disabled={mensagens.length >= MAX_MENSAGENS}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-line text-xs font-medium text-ink-muted hover:text-ink hover:bg-surface transition-all disabled:opacity-40"
        >
          <PlusCircle size={12} /> Adicionar mensagem
        </button>
        {mensagens.length >= MAX_MENSAGENS && (
          <span className="text-[11px] text-ink-faint">Limite por SVG atingido</span>
        )}
      </div>

      <SubmitButton loading={loading} disabled={!valid || loading}>
        {loading ? "Criando..." : `Criar ${mensagens.length} pedido(s)`}
      </SubmitButton>

      {result && <ResultPanel result={result} />}
    </form>
  );
}

// ──────────────────────────────────────────────
// UniqueBox — Bloco (fotos via URL ou upload)
// ──────────────────────────────────────────────

type Bloco = {
  cliente: string;
  modo: "url" | "upload";
  foto_url: string;
  foto_storage_path: string;
  foto_preview: string;
  uploading: boolean;
};

function UniqueBoxBlocoForm() {
  const [blocos, setBlocos] = useState<Bloco[]>([
    { cliente: "", modo: "url", foto_url: "", foto_storage_path: "", foto_preview: "", uploading: false },
  ]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ResultPayload | null>(null);

  const update = (i: number, patch: Partial<Bloco>) =>
    setBlocos((prev) => prev.map((b, j) => (j === i ? { ...b, ...patch } : b)));

  const add = () =>
    setBlocos((prev) =>
      prev.length < MAX_BLOCOS
        ? [
            ...prev,
            { cliente: "", modo: "url", foto_url: "", foto_storage_path: "", foto_preview: "", uploading: false },
          ]
        : prev
    );

  const remove = (i: number) =>
    setBlocos((prev) => (prev.length === 1 ? prev : prev.filter((_, j) => j !== i)));

  async function handleUpload(i: number, file: File) {
    update(i, { uploading: true });
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/avulso/upload-foto", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha no upload");
      update(i, {
        foto_storage_path: data.storage_path,
        foto_preview: data.public_url,
        uploading: false,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro no upload");
      update(i, { uploading: false });
    }
  }

  const valid = blocos.every(
    (b) =>
      b.cliente.trim() &&
      ((b.modo === "url" && b.foto_url.trim()) || (b.modo === "upload" && b.foto_storage_path))
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/avulso/uniquebox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo: "bloco",
          blocos: blocos.map((b) => ({
            cliente: b.cliente.trim(),
            ...(b.modo === "url"
              ? { foto_url: b.foto_url.trim() }
              : { foto_storage_path: b.foto_storage_path }),
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro");
      setResult(data);
      toast.success(`${data.total_pedidos} bloco(s) criado(s)`);
      setBlocos([
        { cliente: "", modo: "url", foto_url: "", foto_storage_path: "", foto_preview: "", uploading: false },
      ]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-line bg-paper p-5 shadow-sm space-y-4"
    >
      <SectionHeader
        bullet="bg-uniquebox"
        title="UniqueBox — Bloco P (10x15 cm)"
        count={`${blocos.length}/${MAX_BLOCOS}`}
      />

      <div className="space-y-3">
        {blocos.map((b, i) => (
          <EntryCard key={i} index={i} onRemove={blocos.length > 1 ? () => remove(i) : undefined}>
            <div className="space-y-2">
              <FormField label="Cliente" required>
                <input
                  type="text"
                  value={b.cliente}
                  onChange={(e) => update(i, { cliente: e.target.value })}
                  placeholder="Nome do cliente"
                  className={inputCls}
                  required
                />
              </FormField>

              <div>
                <div className="flex items-center gap-1 mb-1.5">
                  <span className="text-xs font-semibold text-ink-faint uppercase tracking-wider">
                    Foto
                  </span>
                  <span className="text-danger ml-0.5">*</span>
                  <div className="ml-auto flex gap-1 rounded-md border border-line bg-surface p-0.5">
                    {(["url", "upload"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => update(i, { modo: mode })}
                        className={cn(
                          "px-2 py-0.5 rounded text-[10px] font-medium uppercase",
                          b.modo === mode
                            ? "bg-paper text-ink shadow-sm"
                            : "text-ink-faint hover:text-ink"
                        )}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                </div>

                {b.modo === "url" ? (
                  <input
                    type="url"
                    value={b.foto_url}
                    onChange={(e) => update(i, { foto_url: e.target.value })}
                    placeholder="https://..."
                    className={inputCls}
                  />
                ) : (
                  <div className="flex items-center gap-2">
                    <label className="flex-1 cursor-pointer flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-line bg-surface text-xs text-ink-muted hover:border-zinc-400 hover:text-ink transition-colors">
                      {b.uploading ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : b.foto_preview ? (
                        <ImageIcon size={14} className="text-emerald-500" />
                      ) : (
                        <Upload size={14} />
                      )}
                      <span className="truncate">
                        {b.foto_preview
                          ? "Foto enviada"
                          : b.uploading
                          ? "Enviando..."
                          : "Selecionar arquivo"}
                      </span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        disabled={b.uploading}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleUpload(i, file);
                        }}
                      />
                    </label>
                  </div>
                )}

                {b.foto_preview && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={b.foto_preview}
                    alt="preview"
                    className="mt-2 h-16 w-16 rounded-md object-cover border border-line"
                  />
                )}
              </div>
            </div>
          </EntryCard>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={add}
          disabled={blocos.length >= MAX_BLOCOS}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-line text-xs font-medium text-ink-muted hover:text-ink hover:bg-surface transition-all disabled:opacity-40"
        >
          <PlusCircle size={12} /> Adicionar bloco
        </button>
        {blocos.length >= MAX_BLOCOS && (
          <span className="text-[11px] text-ink-faint">Limite por PNG atingido</span>
        )}
      </div>

      <SubmitButton loading={loading} disabled={!valid || loading}>
        {loading ? "Criando..." : `Criar ${blocos.length} bloco(s)`}
      </SubmitButton>

      {result && <ResultPanel result={result} />}
    </form>
  );
}

// ──────────────────────────────────────────────
// UniqueKids — múltiplos nomes
// ──────────────────────────────────────────────

type NomeEntry = { cliente: string; nome: string };

function UniqueKidsForm() {
  const [molde, setMolde] = useState("NNA");
  const [fonte, setFonte] = useState("MALINDA");
  const [nomes, setNomes] = useState<NomeEntry[]>([{ cliente: "", nome: "" }]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ResultPayload | null>(null);

  const update = (i: number, patch: Partial<NomeEntry>) =>
    setNomes((prev) => prev.map((n, j) => (j === i ? { ...n, ...patch } : n)));

  const add = () => setNomes((prev) => [...prev, { cliente: "", nome: "" }]);
  const remove = (i: number) =>
    setNomes((prev) => (prev.length === 1 ? prev : prev.filter((_, j) => j !== i)));

  const valid = nomes.every((n) => n.cliente.trim() && n.nome.trim());

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/avulso/uniquekids", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          molde,
          fonte,
          nomes: nomes.map((n) => ({ cliente: n.cliente.trim(), nome: n.nome.trim() })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro");
      setResult(data);
      toast.success(`${data.total_pedidos} pedido(s) criado(s)`);
      setNomes([{ cliente: "", nome: "" }]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-line bg-paper p-5 shadow-sm space-y-4"
    >
      <SectionHeader
        bullet="bg-uniquekids"
        title="UniqueKids — Avulso"
        count={`${nomes.length} nome(s)`}
      />

      <div className="grid grid-cols-2 gap-3">
        <FormField label="Molde">
          <select value={molde} onChange={(e) => setMolde(e.target.value)} className={inputCls}>
            <option value="NNA">NNA</option>
            <option value="NM AV">NM AV</option>
            <option value="NM AV CP">NM AV CP</option>
            <option value="NNA CP">NNA CP</option>
            <option value="TD">TD</option>
            <option value="PD">PD</option>
          </select>
        </FormField>
        <FormField label="Fonte">
          <select value={fonte} onChange={(e) => setFonte(e.target.value)} className={inputCls}>
            <option value="MALINDA">Malinda</option>
            <option value="FORMA">Forma</option>
            <option value="TD">TD</option>
            <option value="PD">PD</option>
          </select>
        </FormField>
      </div>

      <div className="space-y-2">
        {nomes.map((n, i) => (
          <EntryCard key={i} index={i} onRemove={nomes.length > 1 ? () => remove(i) : undefined}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <FormField label="Cliente" required>
                <input
                  type="text"
                  value={n.cliente}
                  onChange={(e) => update(i, { cliente: e.target.value })}
                  placeholder="Nome do cliente"
                  className={inputCls}
                  required
                />
              </FormField>
              <FormField label="Nome" required>
                <input
                  type="text"
                  value={n.nome}
                  onChange={(e) => update(i, { nome: e.target.value })}
                  placeholder="Nome para personalizar"
                  className={inputCls}
                  required
                />
              </FormField>
            </div>
          </EntryCard>
        ))}
      </div>

      <button
        type="button"
        onClick={add}
        className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-line text-xs font-medium text-ink-muted hover:text-ink hover:bg-surface transition-all"
      >
        <PlusCircle size={12} /> Adicionar nome
      </button>

      <SubmitButton loading={loading} disabled={!valid || loading}>
        {loading ? "Criando..." : `Criar ${nomes.length} pedido(s)`}
      </SubmitButton>

      {result && <ResultPanel result={result} />}
    </form>
  );
}

// ──────────────────────────────────────────────
// Helpers UI
// ──────────────────────────────────────────────

const inputCls =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-zinc-400 focus:outline-none transition-colors";

function SectionHeader({
  bullet,
  title,
  count,
}: {
  bullet: string;
  title: string;
  count?: string;
}) {
  return (
    <div className="flex items-center gap-2 mb-1">
      <div className={cn("w-2 h-2 rounded-full", bullet)} />
      <h2 className="text-xs font-semibold text-ink-faint uppercase tracking-wider">{title}</h2>
      {count && <span className="ml-auto text-[10px] text-ink-faint tabular-nums">{count}</span>}
    </div>
  );
}

function EntryCard({
  index,
  onRemove,
  children,
}: {
  index: number;
  onRemove?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface/30 p-3 relative">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold text-ink-faint uppercase">#{index + 1}</span>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="text-ink-faint hover:text-danger transition-colors"
            title="Remover"
          >
            <X size={14} />
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function FormField({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-ink-faint uppercase tracking-wider mb-1.5">
        {label}
        {required && <span className="text-danger ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

function SubmitButton({
  loading,
  disabled,
  children,
}: {
  loading: boolean;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className="w-full flex items-center justify-center gap-1.5 bg-ink text-paper rounded-lg py-2.5 text-sm font-medium hover:opacity-90 active:scale-[0.97] disabled:opacity-50 transition-all"
    >
      {loading ? <Loader2 size={14} className="animate-spin" /> : <PlusCircle size={14} />}
      {children}
    </button>
  );
}

function ResultPanel({ result }: { result: ResultPayload }) {
  return (
    <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 p-3 text-xs space-y-2">
      <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 font-semibold">
        <CheckCircle2 size={14} />
        {result.total_pedidos} pedido(s) — lote {result.lote_id.slice(0, 8)}…
      </div>
      {result.arquivos && result.arquivos.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {result.arquivos.map((a) => (
            <a
              key={a.id}
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-emerald-200 bg-paper/60 text-[10px] text-emerald-700 hover:bg-paper transition-colors dark:border-emerald-900"
            >
              {a.nome}
            </a>
          ))}
        </div>
      )}
      {result.arquivos && result.arquivos.length === 0 && (
        <p className="text-emerald-700 dark:text-emerald-400">
          Arquivos sendo gerados — apareçeráo no kanban de Produção.
        </p>
      )}
    </div>
  );
}
