"use client";

/**
 * components/dashboard/AiPlayground.tsx
 *
 * Interactive AI Playground tab — lets users pay USDC via x402 and get
 * real Gemini responses routed through their selected DePIN operator.
 *
 * Uses the connected wallet to sign the USDC payment directly in-browser.
 */

import { useState, useRef, useEffect } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction } from "@solana/web3.js";
import {
  createTransferInstruction,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import * as crypto from "node:crypto";

// ── Types ──────────────────────────────────────────────────────────────────

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

interface Model {
  id: string;
  pricePerRequest: number;
  currency: string;
  description: string;
}

interface ChatEntry {
  id: string;
  role: "user" | "assistant";
  content: string;
  cost?: number;
  settlementTx?: string;
  timestamp: number;
  pending?: boolean;
  error?: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

const USDC_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_USDC_MINT ?? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
);
const FACILITATOR_URL =
  process.env.NEXT_PUBLIC_FACILITATOR_URL ?? "http://localhost:4000";

// ── Helpers ────────────────────────────────────────────────────────────────

function formatUSDC(microUsdc: number) {
  return (microUsdc / 1_000_000).toFixed(4);
}

function shortTx(sig: string) {
  return `${sig.slice(0, 6)}…${sig.slice(-4)}`;
}

// ── Component ──────────────────────────────────────────────────────────────

export default function AiPlayground() {
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();

  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState("gemini-2.0-flash");
  const [prompt, setPrompt] = useState("");
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [systemPrompt, setSystemPrompt] = useState(
    "You are a helpful assistant. Be concise."
  );
  const [totalSpent, setTotalSpent] = useState(0);
  const [loading, setLoading] = useState(false);
  const [showSystem, setShowSystem] = useState(false);
  const [facilitatorAddress, setFacilitatorAddress] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Load models on mount ────────────────────────────────────────────────
  useEffect(() => {
    fetch(`${FACILITATOR_URL}/ai/models`)
      .then((r) => r.json())
      .then((d) => {
        setModels(d.models ?? []);
        setFacilitatorAddress(d.facilitator);
        if (d.models?.length > 0 && !d.models.find((m: Model) => m.id === selectedModel)) {
          setSelectedModel(d.models[0].id);
        }
      })
      .catch(() => {
        // Fallback models if facilitator is offline — must match the
        // Gemini whitelist in packages/facilitator/ai_proxy.ts (MODEL_PRICES).
        setModels([
          { id: "gemini-2.0-flash",         pricePerRequest:  500, currency: "µUSDC", description: "500 µUSDC per request" },
          { id: "gemini-2.5-flash-preview", pricePerRequest:  800, currency: "µUSDC", description: "800 µUSDC per request" },
          { id: "gemini-2.5-pro-preview",   pricePerRequest: 3000, currency: "µUSDC", description: "3000 µUSDC per request" },
        ]);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Auto-scroll ─────────────────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat]);

  // ── Send message ─────────────────────────────────────────────────────────
  async function sendMessage() {
    if (!prompt.trim() || loading || !publicKey || !signTransaction) return;

    const userMsg = prompt.trim();
    setPrompt("");

    const userEntry: ChatEntry = {
      id: crypto.randomUUID(),
      role: "user",
      content: userMsg,
      timestamp: Date.now(),
    };

    const pendingEntry: ChatEntry = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      pending: true,
      timestamp: Date.now(),
    };

    setChat((c) => [...c, userEntry, pendingEntry]);
    setLoading(true);

    try {
      // Build messages history for context
      const messages: Message[] = [
        { role: "system", content: systemPrompt },
        ...chat
          .filter((e) => !e.pending && !e.error)
          .map((e) => ({ role: e.role, content: e.content })),
        { role: "user", content: userMsg },
      ];

      // ── Step 1: Request without payment (get 402) ──────────────────────
      const firstRes = await fetch(`${FACILITATOR_URL}/ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: selectedModel, messages, max_tokens: 1024 }),
      });

      if (firstRes.status !== 402) {
        throw new Error(`Expected 402, got ${firstRes.status}`);
      }

      const paymentData = await firstRes.json();
      const req = paymentData.paymentRequired?.[0];
      if (!req) throw new Error("No payment requirements in 402");

      const amount = parseInt(req.maxAmountRequired);
      const payTo = new PublicKey(req.payTo ?? facilitatorAddress!);

      // ── Step 2: Build + sign USDC transfer ────────────────────────────
      const payerUSDC = await getAssociatedTokenAddress(USDC_MINT, publicKey);
      const facilitatorUSDC = await getAssociatedTokenAddress(USDC_MINT, payTo);

      const tx = new Transaction().add(
        createTransferInstruction(
          payerUSDC,
          facilitatorUSDC,
          publicKey,
          amount,
          [],
          TOKEN_PROGRAM_ID
        )
      );

      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;

      const signed = await signTransaction(tx);
      const txSig = await connection.sendRawTransaction(signed.serialize());
      await connection.confirmTransaction(txSig, "confirmed");

      // ── Step 3: Build payment header ──────────────────────────────────
      const nonce = crypto.randomUUID().replace(/-/g, "");
      const payloadObj = {
        scheme: "exact",
        network: "solana-devnet",
        payload: {
          signature: txSig,
          payer: publicKey.toBase58(),
          amount,
          nonce,
          resource: `ai:${selectedModel}`,
        },
      };
      const paymentHeader = btoa(JSON.stringify(payloadObj));

      // ── Step 4: Retry with payment ────────────────────────────────────
      const paidRes = await fetch(`${FACILITATOR_URL}/ai`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-PAYMENT": paymentHeader,
        },
        body: JSON.stringify({ model: selectedModel, messages, max_tokens: 1024 }),
      });

      if (!paidRes.ok) {
        const err = await paidRes.json();
        throw new Error(err.error ?? `HTTP ${paidRes.status}`);
      }

      const response = await paidRes.json();
      const aiContent = response.choices?.[0]?.message?.content ?? "(empty response)";
      const settlementTx =
        paidRes.headers.get("X-SETTLEMENT-TX") ?? response._payment?.transaction;

      setTotalSpent((s) => s + amount);

      setChat((c) =>
        c.map((e) =>
          e.id === pendingEntry.id
            ? { ...e, content: aiContent, pending: false, cost: amount, settlementTx }
            : e
        )
      );
    } catch (err: unknown) {
      console.error("[AiPlayground]", err);
      const message = err instanceof Error ? err.message : "Unknown error";
      setChat((c) =>
        c.map((e) =>
          e.id === pendingEntry.id
            ? { ...e, pending: false, error: message, content: "" }
            : e
        )
      );
    } finally {
      setLoading(false);
    }
  }

  const currentModelPrice =
    models.find((m) => m.id === selectedModel)?.pricePerRequest ?? 0;

  return (
    <div className="flex flex-col h-full min-h-[600px] gap-4">
      {/* ── Header bar ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-semibold text-foreground">AI Playground</h2>
          <p className="text-sm text-muted-foreground">
            Pay USDC per request · Settled on Solana · Routed through DePIN operators
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Model selector */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground uppercase tracking-wide">
              Model
            </label>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="bg-card border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id} — {m.pricePerRequest} µUSDC
                </option>
              ))}
            </select>
          </div>

          {/* Cost badge */}
          <div className="flex flex-col items-end gap-1">
            <span className="text-xs text-muted-foreground uppercase tracking-wide">
              Per request
            </span>
            <span className="font-mono text-sm font-semibold text-emerald-500">
              {formatUSDC(currentModelPrice)} USDC
            </span>
          </div>

          {/* Total spent */}
          {totalSpent > 0 && (
            <div className="flex flex-col items-end gap-1">
              <span className="text-xs text-muted-foreground uppercase tracking-wide">
                Session total
              </span>
              <span className="font-mono text-sm font-semibold text-orange-500">
                {formatUSDC(totalSpent)} USDC
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── System prompt toggle ─────────────────────────────────────────── */}
      <div className="border border-border rounded-xl overflow-hidden">
        <button
          onClick={() => setShowSystem((s) => !s)}
          className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
        >
          <span className="font-medium">System Prompt</span>
          <span className="opacity-60">{showSystem ? "▲" : "▼"}</span>
        </button>
        {showSystem && (
          <div className="px-4 pb-3 border-t border-border">
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={3}
              className="w-full mt-2 bg-transparent text-sm text-foreground resize-none focus:outline-none"
              placeholder="System instructions for the AI..."
            />
          </div>
        )}
      </div>

      {/* ── Chat window ──────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto border border-border rounded-xl p-4 space-y-4 bg-background/40">
        {chat.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-center py-16">
            <div className="text-4xl">🤖</div>
            <p className="text-muted-foreground text-sm max-w-xs">
              Ask anything. Each response costs{" "}
              <span className="text-foreground font-mono">
                {formatUSDC(currentModelPrice)} USDC
              </span>{" "}
              settled on-chain via x402.
            </p>
            {!publicKey && (
              <p className="text-orange-500 text-xs font-medium">
                Connect your wallet to start
              </p>
            )}
          </div>
        )}

        {chat.map((entry) => (
          <div
            key={entry.id}
            className={`flex ${entry.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                entry.role === "user"
                  ? "bg-primary text-primary-foreground rounded-br-sm"
                  : "bg-card border border-border rounded-bl-sm"
              }`}
            >
              {entry.pending ? (
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <span className="animate-pulse">Paying + thinking</span>
                  <span className="inline-flex gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: "300ms" }} />
                  </span>
                </div>
              ) : entry.error ? (
                <div className="text-red-500 text-sm">
                  <span className="font-medium">Error:</span> {entry.error}
                </div>
              ) : (
                <p className="text-sm leading-relaxed whitespace-pre-wrap">
                  {entry.content}
                </p>
              )}

              {/* Settlement metadata */}
              {entry.settlementTx && (
                <div className="mt-2 pt-2 border-t border-border/40 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="text-emerald-500 font-medium">
                    ✓ {formatUSDC(entry.cost!)} USDC settled
                  </span>
                  <a
                    href={`https://explorer.solana.com/tx/${entry.settlementTx}?cluster=devnet`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-primary transition-colors font-mono"
                  >
                    {shortTx(entry.settlementTx)} ↗
                  </a>
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* ── Input bar ────────────────────────────────────────────────────── */}
      <div className="flex gap-3 items-end">
        <div className="flex-1 border border-border rounded-xl bg-card overflow-hidden focus-within:ring-2 focus-within:ring-primary focus-within:border-primary transition-all">
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            rows={2}
            disabled={loading || !publicKey}
            placeholder={
              !publicKey
                ? "Connect wallet to start…"
                : `Message ${selectedModel} · ${formatUSDC(currentModelPrice)} USDC per reply`
            }
            className="w-full bg-transparent px-4 py-3 text-sm text-foreground resize-none focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </div>

        <button
          onClick={sendMessage}
          disabled={loading || !publicKey || !prompt.trim()}
          className="h-[72px] px-5 rounded-xl font-medium text-sm transition-all bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed flex flex-col items-center justify-center gap-1"
        >
          <span>{loading ? "Paying…" : "Send"}</span>
          {!loading && (
            <span className="text-xs opacity-70 font-mono">
              {formatUSDC(currentModelPrice)} USDC
            </span>
          )}
        </button>
      </div>

      {/* ── Info footer ──────────────────────────────────────────────────── */}
      <div className="text-xs text-muted-foreground text-center">
        Requests routed through operator{" "}
        <span className="font-mono">
          {facilitatorAddress
            ? `${facilitatorAddress.slice(0, 6)}…${facilitatorAddress.slice(-4)}`
            : "…"}
        </span>{" "}
        · Settlements visible on-chain · No API key needed
      </div>
    </div>
  );
}