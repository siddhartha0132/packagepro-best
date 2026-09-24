import { useState } from "react";
import { Bot, MessageSquare, Send, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { type Lang, t } from "@/i18n";

type ParsedTripRequest = {
  origin?: { code: string; city: string };
  destination?: { code: string; city: string };
  durationDays?: number;
  departDate?: string;
  returnDate?: string;
  hotelTier?: "budget" | "boutique" | "luxury";
  transportMode?: "flight" | "train" | "cab";
};
type TripCommand = { type: "swap_hotel" | "remove_guide"; target?: string };

type ChatItem = {
  role: "user" | "assistant";
  content: string;
  modelUsed?: string;
  tripRequest?: ParsedTripRequest;
};

export default function AgentTransparencyChat({
  trip,
  lang,
  destination,
  plannerContext,
  onApplyTrip,
  onBuildPackage,
  onCommand,
}: {
  trip: any;
  lang: Lang;
  destination?: string;
  plannerContext: Record<string, unknown>;
  onApplyTrip: (request: ParsedTripRequest) => void;
  onBuildPackage: (request: ParsedTripRequest) => void;
  onCommand: (command: TripCommand) => void;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatItem[]>([
    {
      role: "assistant",
      content: "I can explain every live PackagePro decision or understand a natural trip request. Try: ‘Make me a two-day Jaipur trip from Delhi next weekend.’",
      modelUsed: "catalogue-aware-free-model-chain",
    },
  ]);

  const explain = trpc.packagepro.explain.useMutation({
    onSuccess: (data) => {
      const parsedRequest = data.tripRequest as ParsedTripRequest | undefined;
      setMessages((prev) => [...prev, { role: "assistant", content: data.text, modelUsed: data.modelUsed, tripRequest: parsedRequest }]);
      if (parsedRequest) onBuildPackage(parsedRequest);
      if (data.command) onCommand(data.command as TripCommand);
    },
    onError: (error) => setMessages((prev) => [...prev, { role: "assistant", content: `I couldn't process that request yet: ${error.message}`, modelUsed: "request-error" }]),
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
        ...plannerContext,
        availableOrigins: plannerContext.availableOrigins,
        availableDestinations: plannerContext.availableDestinations,
        planner: {
          destinationCity: destination,
          budgetCap: trip?.budgetCap || plannerContext.budgetCap,
          interests: plannerContext.interests,
          language: lang,
        },
        currentItinerary: {
          chosenFlight: trip?.chosenFlight,
          chosenHotel: trip?.chosenHotel,
          chosenGuide: trip?.chosenGuide,
          chosenTransport: trip?.chosenTransport,
          package: trip?.package,
          packagePrice: trip?.packagePrice,
        },
        guideAvailabilityIssue: trip?.guideAvailabilityIssue,
        destination: trip?.destination || destination,
        tripId: trip?.tripId,
        budgetCap: trip?.budgetCap,
        runningTotal: trip?.runningTotal,
      },
    });
  };

  return (
    <Card className="border-[#d8d7cd] bg-white/70 shadow-none">
      <CardContent className="p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-[#286c62]" />
            <div className="font-serif text-lg font-semibold">{t(lang, "agentExplains")}</div>
          </div>
          <Button variant="outline" size="sm" onClick={() => setOpen(!open)} className="text-xs whitespace-nowrap">
            <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
            {open ? "Collapse" : t(lang, "askAgent")}
          </Button>
        </div>

        {open && (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap gap-1.5 text-xs">
              <button type="button" onClick={() => send("Why did you recommend this package and destination?")} className="rounded-full bg-[#e1efea] px-2.5 py-1 text-[11px] font-medium text-[#286c62] hover:bg-[#d2e8e0]">Why this package?</button>
              <button type="button" onClick={() => send("Why was this hotel or flight picked for my budget?")} className="rounded-full bg-[#fbf3e4] px-2.5 py-1 text-[11px] font-medium text-[#b6762a] hover:bg-[#f6ebd4]">Why this hotel/flight?</button>
              <button type="button" onClick={() => send("Explain how guide availability and substitution works.")} className="rounded-full border border-[#d8d7cd] bg-[#f7f5ef] px-2.5 py-1 text-[11px] text-[#17231f] hover:bg-[#eae6db]">Guide check rules</button>
            </div>

            <div className="max-h-72 space-y-2 overflow-y-auto rounded-md border border-[#d8d7cd] bg-[#fbfaf6] p-3 text-xs">
              {messages.map((m, idx) => (
                <div key={idx} className={`space-y-1 ${m.role === "user" ? "text-right" : "text-left"}`}>
                  <div className={`inline-block max-w-[95%] rounded-lg px-3 py-2 leading-relaxed ${m.role === "user" ? "bg-[#17231f] text-[#f7f5ef]" : "border border-[#d8d7cd] bg-white text-[#17231f]"}`}>{m.content}</div>
                  {m.tripRequest && <div className="mt-2 rounded border border-[#b8d8cf] bg-[#e1efea]/70 p-2 text-left"><div className="font-semibold text-[#286c62]">{m.tripRequest.origin?.city || "Origin"} → {m.tripRequest.destination?.city || "Destination"} · {m.tripRequest.durationDays || 2} days</div><div className="mt-1 text-[10px] text-[#68736c]">{m.tripRequest.departDate || "Choose dates"}{m.tripRequest.returnDate ? ` → ${m.tripRequest.returnDate}` : ""}</div><div className="mt-2 flex gap-2"><Button size="sm" onClick={() => onBuildPackage(m.tripRequest!)} className="h-7 bg-[#17231f] text-[11px] text-[#f7f5ef] hover:bg-[#283832]">Build complete package</Button><Button size="sm" variant="outline" onClick={() => onApplyTrip(m.tripRequest!)} className="h-7 text-[11px]">{t(lang, "useThisSetup")}</Button></div></div>}
                  {m.modelUsed && <div className="text-[10px] text-[#68736c]">powered by <Badge variant="outline" className="border-[#b8d8cf] px-1 py-0 text-[9px]">{m.modelUsed}</Badge></div>}
                </div>
              ))}
              {explain.isPending && <div className="flex items-center gap-1 text-left text-[11px] text-[#68736c]"><Sparkles className="h-3 w-3 animate-spin text-[#286c62]" /> Understanding the request against PackagePro data…</div>}
            </div>

            <div className="flex gap-2">
              <Input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder={t(lang, "agentPlaceholder")} className="bg-[#fbfaf6] text-xs" />
              <Button disabled={explain.isPending || !input.trim()} onClick={() => send()} size="sm" className="bg-[#17231f] text-[#f7f5ef] hover:bg-[#283832]"><Send className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
