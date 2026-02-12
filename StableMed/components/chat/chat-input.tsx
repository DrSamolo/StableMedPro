"use client";

import { useMemo, useRef, useState } from "react";
import { Send } from "lucide-react";

import type { MentionParticipant } from "@/schemas/chat-conversations";

type ChatInputProps = {
  participants: MentionParticipant[];
  isSending: boolean;
  onSend: (content: string) => Promise<void>;
  errorMessage?: string | null;
};

type MentionContext = {
  query: string;
  start: number;
  end: number;
};

function getMentionContext(value: string, cursor: number): MentionContext | null {
  const textBeforeCursor = value.slice(0, cursor);
  const match = textBeforeCursor.match(/(^|\s)@([a-z0-9_.-]*)$/i);
  if (!match) return null;

  const query = match[2] ?? "";
  const start = cursor - query.length - 1;
  return { query: query.toLowerCase(), start, end: cursor };
}

export function ChatInput({ participants, isSending, onSend, errorMessage }: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [draft, setDraft] = useState("");
  const [mentionContext, setMentionContext] = useState<MentionContext | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const suggestions = useMemo(() => {
    if (!mentionContext) return [];
    const query = mentionContext.query;
    return participants
      .filter((participant) =>
        query.length === 0 ? true : participant.mention_value.startsWith(query) || participant.display_name.toLowerCase().includes(query),
      )
      .slice(0, 8);
  }, [mentionContext, participants]);

  function updateMentionState(nextValue: string, cursor: number) {
    const nextContext = getMentionContext(nextValue, cursor);
    setMentionContext(nextContext);
    setSelectedIndex(0);
  }

  function applyMention(participant: MentionParticipant) {
    const textarea = textareaRef.current;
    const context = mentionContext;
    if (!textarea || !context) return;

    const before = draft.slice(0, context.start);
    const after = draft.slice(context.end);
    const mentionText = `@${participant.mention_value} `;
    const nextValue = `${before}${mentionText}${after}`;
    const nextCursor = before.length + mentionText.length;

    setDraft(nextValue);
    setMentionContext(null);
    setSelectedIndex(0);

    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(nextCursor, nextCursor);
    });
  }

  async function submitDraft() {
    const content = draft.trim();
    if (!content || isSending) return;
    await onSend(content);
    setDraft("");
    setMentionContext(null);
    setSelectedIndex(0);
  }

  return (
    <div className="border-t border-zinc-200 bg-white p-3 motion-fade-up">
      <div className="relative">
        <div className="flex items-end gap-2 rounded-md border border-zinc-200 bg-zinc-50/80 p-2 shadow-subtle motion-fade-up">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => {
              const nextValue = event.target.value;
              const cursor = event.target.selectionStart ?? nextValue.length;
              setDraft(nextValue);
              updateMentionState(nextValue, cursor);
            }}
            onKeyDown={(event) => {
              if (suggestions.length > 0 && mentionContext) {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setSelectedIndex((index) => (index + 1) % suggestions.length);
                  return;
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setSelectedIndex((index) => (index - 1 + suggestions.length) % suggestions.length);
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setMentionContext(null);
                  setSelectedIndex(0);
                  return;
                }
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  const selected = suggestions[selectedIndex];
                  if (selected) applyMention(selected);
                  return;
                }
              }

              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submitDraft();
              }
            }}
            onClick={(event) => {
              updateMentionState(draft, event.currentTarget.selectionStart ?? draft.length);
            }}
            rows={2}
            disabled={isSending}
            placeholder="Ecrire un message... (utilise @ pour mentionner)"
            className="ui-focus min-h-[2.5rem] w-full resize-none rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 disabled:bg-zinc-100"
          />
          <button
            type="button"
            onClick={() => void submitDraft()}
            disabled={!draft.trim() || isSending}
            className="ui-focus inline-flex h-9 w-9 items-center justify-center rounded-md border border-zinc-900 bg-zinc-900 text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 motion-soft-hover motion-soft-press"
            aria-label="Envoyer"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>

        {mentionContext && suggestions.length > 0 ? (
          <div className="absolute bottom-[calc(100%+0.5rem)] left-0 z-20 w-full max-w-sm rounded-md border border-zinc-200 bg-white p-1 shadow-card motion-scale-in">
            {suggestions.map((participant, index) => {
              const isSelected = index === selectedIndex;
              return (
                <button
                  key={`${participant.user_id}-${participant.mention_value}`}
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    applyMention(participant);
                  }}
                  className={`flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm ${
                    isSelected ? "bg-zinc-100 text-zinc-900" : "text-zinc-700 hover:bg-zinc-100"
                  }`}
                >
                  <span className="truncate">{participant.display_name}</span>
                  <span className={`ml-2 text-xs ${isSelected ? "text-zinc-600" : "text-zinc-500"}`}>
                    @{participant.mention_value}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      {errorMessage ? <p className="mt-2 text-xs text-rose-600">{errorMessage}</p> : null}
    </div>
  );
}
