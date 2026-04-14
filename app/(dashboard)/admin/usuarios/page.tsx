"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus, X, Loader2 } from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { toast } from "sonner";

interface User {
  id: string;
  username: string;
  nome: string;
  role: string;
  ativo: boolean;
  created_at: string;
}

export default function AdminUsuariosPage() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    username: "",
    password: "",
    nome: "",
    role: "operador",
  });
  const [saving, setSaving] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["usuarios"],
    queryFn: async () => {
      const res = await fetch("/api/admin/usuarios");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const users: User[] = data?.data ?? [];

  async function handleCreate() {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/usuarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Erro");
      }
      toast.success("Usuario criado");
      setShowForm(false);
      setFormData({ username: "", password: "", nome: "", role: "operador" });
      queryClient.invalidateQueries({ queryKey: ["usuarios"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(user: User) {
    await fetch("/api/admin/usuarios", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: user.id, ativo: !user.ativo }),
    });
    queryClient.invalidateQueries({ queryKey: ["usuarios"] });
    toast.success(user.ativo ? "Usuario desativado" : "Usuario ativado");
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-ink">Usuarios</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
            showForm
              ? "border border-line text-ink-muted hover:bg-surface"
              : "bg-ink text-paper hover:opacity-90 active:scale-[0.97]"
          )}
        >
          {showForm ? <X size={13} /> : <UserPlus size={13} />}
          {showForm ? "Cancelar" : "Novo Usuario"}
        </button>
      </div>

      {showForm && (
        <div className="rounded-xl border border-line bg-paper p-5 shadow-sm space-y-3 max-w-md animate-slide-up">
          <FormField label="Username">
            <input
              type="text"
              value={formData.username}
              onChange={(e) => setFormData({ ...formData, username: e.target.value })}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-zinc-400 focus:outline-none"
              placeholder="usuario"
            />
          </FormField>
          <FormField label="Senha">
            <input
              type="password"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-zinc-400 focus:outline-none"
              placeholder="senha"
            />
          </FormField>
          <FormField label="Nome">
            <input
              type="text"
              value={formData.nome}
              onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-zinc-400 focus:outline-none"
              placeholder="Nome completo"
            />
          </FormField>
          <FormField label="Cargo">
            <select
              value={formData.role}
              onChange={(e) => setFormData({ ...formData, role: e.target.value })}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-zinc-400 focus:outline-none"
            >
              <option value="operador">Operador</option>
              <option value="expedicao">Expedicao</option>
              <option value="admin">Admin</option>
            </select>
          </FormField>
          <button
            onClick={handleCreate}
            disabled={saving || !formData.username || !formData.password || !formData.nome}
            className="w-full flex items-center justify-center gap-1.5 bg-ink text-paper rounded-lg py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-all"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {saving ? "Criando..." : "Criar Usuario"}
          </button>
        </div>
      )}

      {isLoading ? (
        <LoadingSpinner message="Carregando usuarios..." />
      ) : (
        <div className="space-y-2">
          {users.map((user, i) => (
            <div
              key={user.id}
              className="flex items-center gap-3 rounded-xl border border-line bg-paper p-4 shadow-sm animate-fade-in"
              style={{ animationDelay: `${i * 30}ms` }}
            >
              <div className={cn(
                "w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold",
                user.ativo
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                  : "bg-zinc-100 text-zinc-400 dark:bg-zinc-800"
              )}>
                {user.nome.charAt(0).toUpperCase()}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-ink">{user.nome}</span>
                  <span className="font-mono text-[11px] text-ink-faint">@{user.username}</span>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                    {user.role}
                  </span>
                  <span className="text-[11px] text-ink-faint">{formatDate(user.created_at)}</span>
                </div>
              </div>

              <button
                onClick={() => toggleActive(user)}
                className={cn(
                  "px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors",
                  user.ativo
                    ? "border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950"
                    : "border-emerald-200 text-emerald-600 hover:bg-emerald-50 dark:border-emerald-900 dark:hover:bg-emerald-950"
                )}
              >
                {user.ativo ? "Desativar" : "Ativar"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-ink-faint uppercase tracking-wider mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}
