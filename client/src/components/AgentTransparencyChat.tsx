import { useState } from "react";
import { Bot, MessageSquare, Send, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { type Lang, t } from "@/i18n";

type ChatItem = {
  role: "user" | "assistant";
  content: string;
  modelUsed?: string;
};

export default function AgentTransparencyChat({ trip, lang, destination }: { trip: any; lang: Lang; destination?: string }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatItem[]>([
    {
      role: "assistant",
      content: `I'm your transparent PackagePro assistant. Ask me why any flight, hotel, package, or guide replacement was suggested. I'll explain the exact reasons, budget math, and availability checks.`,
      modelUsed: "openrouter-free-chain",
    },
  ]);

  const explain = trpc.packagepro.explain.useMutation({
    onSuccess: (data) => {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.text, modelUsed: data.modelUsed },
      ]);
    },
  });

  const send = (textToSend?: string) => {
    const q = (textToSend || input).trim();
    if (!q || explain.isPending) return;
    const next: ChatItem[] = [...messages, { role: "user", content: q }];
    setMessages(next);
    setInput("");
    explain.mutate({
      messages: next.map(m => ({ role: m.role, content: m.content })),
      context: {
        destination: trip?.destination || destination,
        budgetCap: trip?.budgetCap,
        runningTotal: trip?.runningTotal,
        chosenFlight: trip?.chosenFlight,
        chosenHotel: trip?.chosenHotel,
        chosenGuide: trip?.chosenGuide,
        guideAvailabilityIssue: trip?.guideAvailabilityIssue,
      },
    });
  };

  return (
    <Card className="border-[#d8d7cd] bg-white/70 shadow-none">
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-[#286c62]" />
            <div className="font-serif text-lg font-semibold">{t(lang, "agentExplains")}</div>
          </div>
          <Button variant="outline" size="sm" onClick={() => setOpen(!open)} className="text-xs">
            <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
            {open ? "Collapse" : t(lang, "askAgent")}
          </Button>
        </div>

        {open && (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap gap-1.5 text-xs">
              <button
                type="button"
                onClick={() => send("Why did you recommend this package and destination?")}
                className="rounded-full bg-[#e1efea] px-2.5 py-1 text-[11px] font-medium text-[#286c62] hover:bg-[#d2e8e0]"
              >
                Why this package?
              </button>
              <button
                type="button"
                onClick={() => send("Why was this hotel or flight picked for my budget?")}
                className="rounded-full bg-[#fbf3e4] px-2.5 py-1 text-[11px] font-medium text-[#b6762a] hover:bg-[#f6ebd4]"
              >
                Why this hotel/flight?
              </button>
              <button
                type="button"
                onClick={() => send("Explain how guide availability and substitution works.")}
                className="rounded-full bg-[#f7f5ef] border border-[#d8d7cd] px-2.5 py-1 text-[11px] text-[#17231f] hover:bg-[#eae6db]"
              >
                Guide check rules
              </button>
            </div>

            <div className="max-h-60 overflow-y-auto space-y-2 rounded-md border border-[#d8d7cd] bg-[#fbfaf6] p-3 text-xs">
              {messages.map((m, idx) => (
                <div key={idx} className={`space-y-1 ${m.role === "user" ? "text-right" : "text-left"}`}>
                  <div
                    className={`inline-block rounded-lg px-3 py-2 leading-relaxed ${
                      m.role === "user"
                        ? "bg-[#17231f] text-[#f7f5ef]"
                        : "bg-white border border-[#d8d7cd] text-[#17231f]"
                    }`}
                  >
                    {m.content}
                  </div>
                  {m.modelUsed && (
                    <div className="text-[10px] text-[#68736c]">
                      powered by <Badge variant="outline" className="text-[9px] py-0 px-1 border-[#b8d8cf]">{m.modelUsed}</Badge>
                    </div>
                  )}
                </div>
              ))}
              {explain.isPending && (
                <div className="text-left text-[11px] text-[#68736c] flex items-center gap-1">
                  <Sparkles className="h-3 w-3 animate-spin text-[#286c62]" /> Analyzing package trade-offs...
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
                placeholder={t(lang, "agentPlaceholder")}
                className="text-xs bg-[#fbfaf6]"
              />
              <Button
                disabled={explain.isPending || !input.trim()}
                onClick={() => send()}
                size="sm"
                className="bg-[#17231f] text-[#f7f5ef] hover:bg-[#283832]"
              >
                <Send className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
