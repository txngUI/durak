import { CHAT_MAX_LENGTH, type RoomView } from '@durak/engine';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { HostBadge } from './HostBadge';

/** Fil de discussion du salon. `active` : visible à l'écran (marque les messages comme lus). */
export function Chat({ room, active = true, autoFocus = false }: { room: RoomView; active?: boolean; autoFocus?: boolean }) {
  const { sendChat, markChatSeen } = useStore();
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const lastId = room.chat.at(-1)?.id ?? 0;

  useEffect(() => {
    if (!active) return;
    markChatSeen();
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [active, lastId, markChatSeen]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    if (await sendChat(t)) setText('');
  };

  return (
    <div className="chat">
      <div className="chat-list" ref={listRef} aria-live="polite">
        {room.chat.length === 0 && <p className="chat-empty">Pas encore de message. Dis bonjour !</p>}
        {room.chat.map((m) =>
          m.from === null ? (
            <p key={m.id} className="chat-system">
              {m.text}
            </p>
          ) : (
            <p key={m.id} className={m.from === room.you ? 'mine' : ''}>
              <b>{m.name}</b>
              {m.from === room.hostId && <HostBadge />} {m.text}
            </p>
          ),
        )}
      </div>
      <form className="chat-form" onSubmit={submit}>
        <label htmlFor="chat-input" className="sr-only">
          Message
        </label>
        <input
          id="chat-input"
          className="input"
          value={text}
          maxLength={CHAT_MAX_LENGTH}
          placeholder="Écris un message…"
          autoComplete="off"
          autoFocus={autoFocus}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="btn primary small" disabled={!text.trim()}>
          Envoyer
        </button>
      </form>
    </div>
  );
}

export function useUnreadChat(room: RoomView) {
  const seen = useStore((s) => s.chatSeen);
  return room.chat.filter((m) => m.id > seen && m.from !== null && m.from !== room.you).length;
}
