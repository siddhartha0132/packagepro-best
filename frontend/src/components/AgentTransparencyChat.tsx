import { useEffect, useRef, useState } from "react";
import { Bot, Loader2, MessageSquare, Mic, Send, Sparkles, Square, Volume2 } from "lucide-react";
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

type PackageSuggestion = { packageId: string; cityId: string; city: string; name: string; theme: string; duration: number; basePrice: number; reason: string };

type ChatItem = {
  role: "user" | "assistant";
  content: string;
  /** For a voice message: the words as spoken (native script); `content` holds their English meaning for the planner. */
  heard?: string;
  modelUsed?: string;
  tripRequest?: ParsedTripRequest;
  suggestions?: PackageSuggestion[];
};

/** One reply voice for the page, so a new reply stops the previous one. */
let replyPlayer: HTMLAudioElement | null = null;

/** Render the **bold** markers LLM replies use; everything else stays plain text. */
function RichText({ text }: { text: string }) {
  return <>{text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => part.startsWith("**") && part.endsWith("**") ? <strong key={index}>{part.slice(2, -2)}</strong> : <span key={index}>{part}</span>)}</>;
}

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
      content: t(lang, "agentWelcome"),
      modelUsed: "catalogue-aware-free-model-chain",
    },
  ]);

  // Voice: record a short clip, Sarvam hears it (native words + English meaning), the answer is read back aloud.
  const voiceStatus = trpc.voice.status.useQuery(undefined, { staleTime: Infinity });
  const hearVoice = trpc.voice.hear.useMutation();
  const [speaking, setSpeaking] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const speakNextReply = useRef(false);
  const maxSeconds = voiceStatus.data?.maxSeconds ?? 30;
  const canRecord = Boolean(voiceStatus.data?.enabled) && typeof window !== "undefined" && "MediaRecorder" in window;

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setSeconds(value => {
      if (value + 1 >= maxSeconds) recorder.current?.stop();
      return value + 1;
    }), 1000);
    return () => clearInterval(timer);
  }, [recording, maxSeconds]);

  // Played from a plain promise (not a component callback): a voice request that builds a trip switches screens and
  // re-creates this chat, and the spoken reply must still play.
  const readAloud = (text: string) => {
    setSpeaking(true);
    // Its own request (not batched with trip building, which can take seconds), so the voice comes back at once.
    void fetch("/api/trpc/voice.speak", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ json: { text, language: lang } }) })
      .then(response => response.json() as Promise<{ result?: { data?: { json?: { audio: string; mime: string } | null } } }>)
      .then(body => {
      const result = body.result?.data?.json;
      if (!result) return;
      replyPlayer?.pause();
      replyPlayer = new Audio(`data:${result.mime};base64,${result.audio}`);
      return replyPlayer.play();
    }).catch(() => undefined).finally(() => setSpeaking(false));
  };

  async function startRecording() {
    setVoiceNote(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const media = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      media.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      media.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());
        setRecording(false);
        const blob = new Blob(chunks, { type: media.mimeType || "audio/webm" });
        if (!blob.size) return;
        const audio = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1] ?? ""); reader.readAsDataURL(blob); });
        hearVoice.mutate({ audio, mime: blob.type }, {
          onSuccess: heard => {
            if (!heard?.english) return setVoiceNote(t(lang, "voiceFailed"));
            speakNextReply.current = true;
            send(heard.english, heard.native);
          },
          onError: error => setVoiceNote(error.message),
        });
      };
      recorder.current = media;
      setSeconds(0);
      setRecording(true);
      media.start();
    } catch {
      setVoiceNote(t(lang, "micDenied"));
    }
  }

  const explain = trpc.packagepro.explain.useMutation({
    onSuccess: (data) => {
      if (speakNextReply.current) { speakNextReply.current = false; readAloud(data.text); }
      const parsedRequest = data.tripRequest as ParsedTripRequest | undefined;
      setMessages((prev) => [...prev, { role: "assistant", content: data.text, modelUsed: data.modelUsed, tripRequest: parsedRequest, suggestions: (data as { suggestions?: PackageSuggestion[] }).suggestions }]);
      if (parsedRequest) onBuildPackage(parsedRequest);
      if (data.command) onCommand(data.command as TripCommand);
    },
    onError: (error) => setMessages((prev) => [...prev, { role: "assistant", content: `${t(lang, "agentError")} ${error.message}`, modelUsed: "request-error" }]),
  });

  const send = (textToSend?: string, heard?: string) => {
    const q = (textToSend || input).trim();
    if (!q || explain.isPending) return;
    const next: ChatItem[] = [...messages, { role: "user", content: q, heard }];
    setMessages(next);
    setInput("");
    explain.mutate({
      messages: next.map(m => ({ role: m.role, content: m.content })),
      context: {
        ...plannerContext,
        language: lang,
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
    <Card className="rounded-2xl border-0 bg-white shadow-[0_1px_3px_rgba(16,24,40,.08),0_8px_24px_rgba(16,24,40,.06)]">
      <CardContent className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Bot className="h-4 w-4 text-[#0b6bcb]" />
            <div className="text-[15px] font-bold">{t(lang, "agentExplains")}</div>
          </div>
          <Button variant="outline" size="sm" onClick={() => setOpen(!open)} className="h-auto max-w-full whitespace-normal py-1.5 text-left text-xs">
            <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
            {open ? t(lang, "collapse") : t(lang, "askAgent")}
          </Button>
        </div>

        {open && (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap gap-1.5 text-xs">
              <button type="button" onClick={() => send(t(lang, "qWhyPackage"))} className="rounded-full bg-[#e8f1fd] px-2.5 py-1 text-[11px] font-medium text-[#0b6bcb] hover:bg-[#d6e6fb]">{t(lang, "chipWhyPackage")}</button>
              <button type="button" onClick={() => send(t(lang, "qWhyHotel"))} className="rounded-full bg-[#fbf3e4] px-2.5 py-1 text-[11px] font-medium text-[#b6762a] hover:bg-[#f6ebd4]">{t(lang, "chipWhyHotel")}</button>
              <button type="button" onClick={() => send(t(lang, "qGuideRules"))} className="rounded-full border border-[#e6ebf2] bg-[#ffffff] px-2.5 py-1 text-[11px] text-[#0b1f3a] hover:bg-[#eae6db]">{t(lang, "chipGuideRules")}</button>
            </div>

            <div className="max-h-72 space-y-2 overflow-y-auto rounded-md border border-[#e6ebf2] bg-[#f6f8fb] p-3 text-xs">
              {messages.map((m, idx) => (
                <div key={idx} className={`space-y-1 ${m.role === "user" ? "text-right" : "text-left"}`}>
                  <div className={`inline-block max-w-[95%] rounded-lg px-3 py-2 leading-relaxed ${m.role === "user" ? "bg-[#0b1f3a] text-[#ffffff]" : "border border-[#e6ebf2] bg-white text-[#0b1f3a]"}`}>{idx === 0 && m.role === "assistant" ? t(lang, "agentWelcome") : m.heard ? <><span>🎙 {m.heard}</span>{m.heard !== m.content && <span className="mt-1 block text-[10px] opacity-75">{m.content}</span>}</> : <RichText text={m.content} />}</div>
                  {m.role === "assistant" && idx > 0 && canRecord && <button type="button" onClick={() => readAloud(m.content)} disabled={speaking} className="ml-1 inline-flex items-center gap-1 text-[10px] text-[#0b6bcb] hover:underline disabled:opacity-50"><Volume2 className="h-3 w-3" />{t(lang, "readAloud")}</button>}
                  {m.suggestions && m.suggestions.length > 0 && <div className="mt-2 space-y-1.5 text-left">{m.suggestions.map(item => <div key={item.packageId} className="rounded-lg border border-[#b9d5f6] bg-white p-2.5">
                    <div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="truncate text-[12px] font-bold text-[#0b1f3a]">{item.name}</div><div className="text-[10px] text-[#5f6b7a]">{item.city} · {item.theme} · {item.duration}D</div></div><div className="shrink-0 text-[12px] font-extrabold text-[#0b1f3a]">₹{Math.round(item.basePrice).toLocaleString("en-IN")}</div></div>
                    {item.reason && <div className="mt-1 text-[11px] leading-snug text-[#334155]">✓ {item.reason}</div>}
                    <Button size="sm" onClick={() => onBuildPackage({ destination: { code: item.cityId, city: item.city }, durationDays: item.duration })} className="mt-2 h-7 w-full rounded-full bg-gradient-to-r from-[#53b2fe] to-[#065af3] text-[11px] font-bold text-white">{t(lang, "buildThis")}</Button>
                  </div>)}</div>}
                  {m.tripRequest && <div className="mt-2 rounded border border-[#b9d5f6] bg-[#e8f1fd]/70 p-2 text-left"><div className="font-semibold text-[#0b6bcb]">{m.tripRequest.origin?.city || t(lang, "from")} → {m.tripRequest.destination?.city || t(lang, "to")} · {m.tripRequest.durationDays || 2} {t(lang, "days")}</div><div className="mt-1 text-[10px] text-[#5f6b7a]">{m.tripRequest.departDate || t(lang, "chooseDates")}{m.tripRequest.returnDate ? ` → ${m.tripRequest.returnDate}` : ""}</div><div className="mt-2 flex gap-2"><Button size="sm" onClick={() => onBuildPackage(m.tripRequest!)} className="h-7 bg-[#0b1f3a] text-[11px] text-[#ffffff] hover:bg-[#13325e]">{t(lang, "buildComplete")}</Button><Button size="sm" variant="outline" onClick={() => onApplyTrip(m.tripRequest!)} className="h-7 text-[11px]">{t(lang, "useThisSetup")}</Button></div></div>}
                  {m.modelUsed && <div className="text-[10px] text-[#5f6b7a]">{t(lang, "poweredBy")} <Badge variant="outline" className="border-[#b9d5f6] px-1 py-0 text-[9px]">{m.modelUsed}</Badge></div>}
                </div>
              ))}
              {explain.isPending && <div className="flex items-center gap-1 text-left text-[11px] text-[#5f6b7a]"><Sparkles className="h-3 w-3 animate-spin text-[#0b6bcb]" /> {t(lang, "agentThinking")}</div>}
            </div>

            {(voiceNote || hearVoice.isPending) && <div className="text-[11px] text-[#5f6b7a]">{hearVoice.isPending ? t(lang, "voiceHearing") : voiceNote}</div>}
            <div className="flex gap-2">
              {canRecord && <Button type="button" size="sm" variant={recording ? "default" : "outline"} disabled={hearVoice.isPending || explain.isPending} onClick={() => recording ? recorder.current?.stop() : void startRecording()} title={t(lang, recording ? "voiceStop" : "voiceRecord")} className={recording ? "animate-pulse bg-[#c0392b] text-white hover:bg-[#a93226]" : "text-[#0b6bcb]"}>
                {hearVoice.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : recording ? <><Square className="mr-1 h-3 w-3" />{seconds}s</> : <Mic className="h-3.5 w-3.5" />}
              </Button>}
              <Input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder={recording ? t(lang, "voiceListening") : t(lang, "agentPlaceholder")} className="bg-[#f6f8fb] text-xs" />
              <Button disabled={explain.isPending || !input.trim()} onClick={() => send()} size="sm" className="bg-[#0b1f3a] text-[#ffffff] hover:bg-[#13325e]"><Send className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
