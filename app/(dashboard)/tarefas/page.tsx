import { redirect } from "next/navigation";

// Tarefas was replaced by the Producao kanban
export default function TarefasRedirect() {
  redirect("/producao");
}
