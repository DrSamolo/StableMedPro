"use client";

import { FormEvent, useState, useTransition } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";

import { supabase } from "@/lib/supabase";
import { ChatCandidateSchema, type ChatCandidate } from "@/schemas/chat-conversations";

function labelForCandidate(candidate: ChatCandidate) {
  return candidate.full_name?.trim() || candidate.email?.split("@")[0] || candidate.user_id.slice(0, 8);
}

export function CreateConversationButton() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  const [candidates, setCandidates] = useState<ChatCandidate[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function loadCandidates() {
    const { data, error: rpcError } = await supabase.rpc("get_chat_candidates");
    if (rpcError) {
      throw new Error(rpcError.message);
    }
    const rows = (data ?? []).map((row: unknown) => ChatCandidateSchema.parse(row));
    setCandidates(rows);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const conversationName = name.trim();
    if (conversationName.length < 2) {
      setError("Le nom doit contenir au moins 2 caracteres.");
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        const { data, error } = await supabase.rpc("create_group_conversation_with_participants", {
          p_name: conversationName,
          p_description: null,
          p_participant_ids: selectedUserIds,
        });

        if (error || !data) {
          throw new Error(error?.message ?? "Creation impossible");
        }

        setName("");
        setSearch("");
        setSelectedUserIds([]);
        setIsOpen(false);
        router.push(`/dashboard/chat/${data}`);
        router.refresh();
      } catch (submissionError) {
        setError(submissionError instanceof Error ? submissionError.message : "Creation impossible");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setIsOpen(true);
          void loadCandidates().catch((loadError: unknown) => {
            setError(loadError instanceof Error ? loadError.message : "Chargement des utilisateurs impossible");
          });
        }}
        className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-600 transition hover:border-zinc-300 hover:text-zinc-900"
      >
        <Plus className="h-3.5 w-3.5" />
        Nouveau
      </button>

      {isOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/30 p-4 backdrop-blur-sm"
          onClick={() => setIsOpen(false)}
        >
          <form
            onSubmit={onSubmit}
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-md space-y-2 rounded-xl border border-zinc-200 bg-white p-3 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-zinc-800">Nouvelle conversation</p>
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  setName("");
                  setSearch("");
                  setError(null);
                }}
                className="text-zinc-400 transition hover:text-zinc-700"
                aria-label="Fermer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ex: Equipe vente"
              autoFocus
              disabled={isPending}
              className="h-9 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-800 outline-none focus:border-zinc-500"
            />

            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Ajouter des participants..."
              disabled={isPending}
              className="h-9 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-800 outline-none focus:border-zinc-500"
            />

            <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-zinc-200 bg-zinc-50 p-2">
              {candidates
                .filter((candidate) => {
                  const keyword = search.trim().toLowerCase();
                  if (!keyword) return true;
                  return (
                    labelForCandidate(candidate).toLowerCase().includes(keyword) ||
                    (candidate.email ?? "").toLowerCase().includes(keyword)
                  );
                })
                .map((candidate) => {
                  const checked = selectedUserIds.includes(candidate.user_id);
                  return (
                    <label
                      key={candidate.user_id}
                      className="flex cursor-pointer items-center justify-between rounded bg-white px-2 py-1.5 text-xs hover:bg-zinc-100"
                    >
                      <span className="truncate text-zinc-700">{labelForCandidate(candidate)}</span>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => {
                          setSelectedUserIds((previous) => {
                            if (event.target.checked) {
                              if (previous.includes(candidate.user_id)) return previous;
                              return [...previous, candidate.user_id];
                            }
                            return previous.filter((id) => id !== candidate.user_id);
                          });
                        }}
                        className="h-4 w-4"
                      />
                    </label>
                  );
                })}
              {candidates.length === 0 ? (
                <p className="px-2 py-2 text-xs text-zinc-500">Aucun utilisateur disponible.</p>
              ) : null}
            </div>

            {error ? <p className="text-xs text-rose-600">{error}</p> : null}

            <button
              type="submit"
              disabled={isPending || name.trim().length < 2 || selectedUserIds.length === 0}
              className="inline-flex h-9 w-full items-center justify-center gap-1 rounded-md bg-zinc-900 px-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Creer
            </button>
          </form>
        </div>
      ) : null}
    </>
  );
}
