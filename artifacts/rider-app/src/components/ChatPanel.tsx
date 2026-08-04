import { MessageCircle, Send, X } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { useOrderChat } from "@/hooks/useOrderChat";

interface ChatPanelProps {
  orderId: string;
  orderNum?: string | number;
  customerName?: string;
  onClose: () => void;
}

export function ChatPanel({ orderId, orderNum, customerName, onClose }: ChatPanelProps) {
  const { messages, loading, sending, sendMessage } = useOrderChat(orderId);
  const [text, setText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Scroll to bottom whenever messages update
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-focus input when panel opens
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setText("");
    await sendMessage(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b bg-white shrink-0">
        <button
          onClick={onClose}
          className="p-1.5 rounded-full hover:bg-gray-100 transition-colors"
          aria-label="Close chat"
        >
          <X className="w-5 h-5 text-gray-600" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900 truncate">{customerName || "Chat with Customer"}</p>
          {orderNum && (
            <p className="text-xs text-gray-500">Order #{orderNum}</p>
          )}
        </div>
        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" title="Connected" />
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full min-h-[180px] text-center py-8">
            <MessageCircle className="w-14 h-14 text-gray-200 mb-3" />
            <p className="font-medium text-gray-400">No messages yet</p>
            <p className="text-sm text-gray-300 mt-1">
              Send a message to keep the customer updated
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const isRider = msg.fromRole === "rider";
            return (
              <div
                key={msg.id}
                className={`flex ${isRider ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`flex flex-col max-w-[75%] ${isRider ? "items-end" : "items-start"}`}
                >
                  <div
                    className={`px-3.5 py-2 rounded-2xl text-sm leading-relaxed ${
                      isRider
                        ? "bg-brand-500 text-white rounded-br-sm"
                        : "bg-gray-100 text-gray-900 rounded-bl-sm"
                    }`}
                  >
                    {msg.text}
                  </div>
                  <p className="text-[10px] text-gray-400 mt-0.5 mx-1">
                    {msg.time}
                  </p>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 px-3 py-3 border-t bg-white flex gap-2 items-end">
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message…"
          rows={1}
          maxLength={500}
          className="flex-1 resize-none rounded-2xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400 transition-colors"
          style={{ maxHeight: 120 }}
        />
        <button
          onClick={handleSend}
          disabled={!text.trim() || sending}
          aria-label="Send message"
          className="w-10 h-10 rounded-full bg-brand-500 text-white flex items-center justify-center shrink-0 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-brand-600 active:scale-95 transition-all"
        >
          {sending ? (
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </button>
      </div>
    </div>
  );
}
