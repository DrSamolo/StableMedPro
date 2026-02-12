"use client";

import { Fragment } from "react";

type MentionTextProps = {
  content: string;
};

const MENTION_REGEX = /(@[a-zA-Z0-9_.-]+)/g;

export function MentionText({ content }: MentionTextProps) {
  const parts = content.split(MENTION_REGEX);

  return (
    <p className="whitespace-pre-wrap text-sm text-zinc-700">
      {parts.map((part, index) => {
        const isMention = /^@[a-zA-Z0-9_.-]+$/.test(part);
        if (!isMention) {
          return <Fragment key={`${part}-${index}`}>{part}</Fragment>;
        }

        return (
          <span
            key={`${part}-${index}`}
            className="rounded border border-zinc-200 bg-zinc-100 px-1 py-0.5 text-zinc-700"
          >
            {part}
          </span>
        );
      })}
    </p>
  );
}
