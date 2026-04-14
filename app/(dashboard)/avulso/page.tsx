"use client";

import { useState } from "react";
import { PlusCircle, Loader2, CheckCircle2 } from "lucide-react";
import { Tabs, type Tab } from "@/components/ui/tabs";
import { toast } from "sonner";

const TABS_LIST: Tab[] = [
  { id: "uniquebox", label: "UniqueBox" },
  { id: "uniquekids", label: "UniqueKids" },
];

export default function AvulsoPage() {
  const [activeTab, setActiveTab] = useState("uniquebox");

  return (
    <div className="space-y-4 animate-fade-in">
      <h1 className="text-lg font-semibold text-ink">Pedido Avulso</h1>
      <Tabs tabs={TABS_LIST} activeTab={activeTab} onChange={setActiveTab} />

      <div className="max-w-lg">
        {activeTab === "uniquebox" ? <UniqueBoxForm /> : <UniqueKidsForm />}
      </div>
    </div>
  );
}

function UniqueBoxForm() {
  const [cliente, setCliente] = useState("");
  const [linhas, setLinhas] = useState(["", "", ""]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ pedido_id: string } | null>(null);

  function updateLinha(i: number, val: string) {
    setLinhas((prev) => prev.map((l, j) => (j === i ? val : l)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!cliente.trim()) return;
    setLoading(true);
    setResult(null);

    try {
      const res = await fetch("/api/avulso/uniquebox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cliente: cliente.trim(),
          linha1: linhas[0],
          linha2: linhas[1],
          linha3: linhas[2],
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro");

      setResult(data);
      toast.success("Pedido avulso criado");
      setCliente("");
      setLinhas(["", "", ""]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar pedido");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-line bg-paper p-5 shadow-sm space-y-4"
    >
      <div className="flex items-center gap-2 mb-1">
        <div className="w-2 h-2 rounded-full bg-uniquebox" />
        <h2 className="text-xs font-semibold text-ink-faint uppercase tracking-wider">
          UniqueBox Avulso
        </h2>
      </div>

      <FormField label="Cliente" required>
        <input
          type="text"
          value={cliente}
          onChange={(e) => setCliente(e.target.value)}
          placeholder="Nome do cliente"
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-zinc-400 focus:outline-none transition-colors"
          required
        />
      </FormField>

      {linhas.map((val, i) => (
        <FormField key={i} label={`Linha ${i + 1}`}>
          <input
            type="text"
            value={val}
            onChange={(e) => updateLinha(i, e.target.value)}
            placeholder={`Texto da linha ${i + 1}`}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-zinc-400 focus:outline-none transition-colors"
          />
        </FormField>
      ))}

      <button
        type="submit"
        disabled={loading || !cliente.trim()}
        className="w-full flex items-center justify-center gap-1.5 bg-ink text-paper rounded-lg py-2.5 text-sm font-medium hover:opacity-90 active:scale-[0.97] disabled:opacity-50 transition-all"
      >
        {loading ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <PlusCircle size={14} />
        )}
        {loading ? "Criando..." : "Criar Pedido"}
      </button>

      {result && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 text-xs">
          <CheckCircle2 size={14} />
          Pedido criado: {result.pedido_id}
        </div>
      )}
    </form>
  );
}

function UniqueKidsForm() {
  const [cliente, setCliente] = useState("");
  const [nome, setNome] = useState("");
  const [molde, setMolde] = useState("NNA");
  const [fonte, setFonte] = useState("MALINDA");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ pedido_id: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!cliente.trim() || !nome.trim()) return;
    setLoading(true);
    setResult(null);

    try {
      const res = await fetch("/api/avulso/uniquekids", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cliente: cliente.trim(),
          nome: nome.trim(),
          molde,
          fonte,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro");

      setResult(data);
      toast.success("Pedido avulso criado");
      setCliente("");
      setNome("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar pedido");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-line bg-paper p-5 shadow-sm space-y-4"
    >
      <div className="flex items-center gap-2 mb-1">
        <div className="w-2 h-2 rounded-full bg-uniquekids" />
        <h2 className="text-xs font-semibold text-ink-faint uppercase tracking-wider">
          UniqueKids Avulso
        </h2>
      </div>

      <FormField label="Cliente" required>
        <input
          type="text"
          value={cliente}
          onChange={(e) => setCliente(e.target.value)}
          placeholder="Nome do cliente"
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-zinc-400 focus:outline-none transition-colors"
          required
        />
      </FormField>

      <FormField label="Nome" required>
        <input
          type="text"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Nome para personalizar"
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-zinc-400 focus:outline-none transition-colors"
          required
        />
      </FormField>

      <div className="grid grid-cols-2 gap-3">
        <FormField label="Molde">
          <select
            value={molde}
            onChange={(e) => setMolde(e.target.value)}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-zinc-400 focus:outline-none transition-colors"
          >
            <option value="NNA">NNA</option>
            <option value="NM AV">NM AV</option>
            <option value="NM AV CP">NM AV CP</option>
            <option value="NNA CP">NNA CP</option>
            <option value="TD">TD</option>
            <option value="PD">PD</option>
          </select>
        </FormField>

        <FormField label="Fonte">
          <select
            value={fonte}
            onChange={(e) => setFonte(e.target.value)}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-zinc-400 focus:outline-none transition-colors"
          >
            <option value="MALINDA">Malinda</option>
            <option value="FORMA">Forma</option>
            <option value="TD">TD</option>
            <option value="PD">PD</option>
          </select>
        </FormField>
      </div>

      <button
        type="submit"
        disabled={loading || !cliente.trim() || !nome.trim()}
        className="w-full flex items-center justify-center gap-1.5 bg-ink text-paper rounded-lg py-2.5 text-sm font-medium hover:opacity-90 active:scale-[0.97] disabled:opacity-50 transition-all"
      >
        {loading ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <PlusCircle size={14} />
        )}
        {loading ? "Criando..." : "Criar Pedido"}
      </button>

      {result && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 text-xs">
          <CheckCircle2 size={14} />
          Pedido criado: {result.pedido_id}
        </div>
      )}
    </form>
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
